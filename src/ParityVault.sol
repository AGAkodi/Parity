// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IMToken.sol";
import "./interfaces/IComptroller.sol";
import "./interfaces/IPriceOracle.sol";
import "./interfaces/IERC4626.sol" as CustomInterfaces;

contract ParityVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    IMToken public immutable mUSDC;
    IComptroller public immutable comptroller;

    address public keeper;
    address public activeVenue;

    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);
    event MigrationExecuted(address indexed oldVenue, address indexed newVenue, uint256 amountMigrated);

    modifier onlyKeeperOrOwner() {
        require(msg.sender == owner() || msg.sender == keeper, "Caller is not keeper or owner");
        _;
    }

    constructor(
        IERC20 _asset,
        IMToken _mUSDC,
        IComptroller _comptroller,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) ERC4626(_asset) Ownable(msg.sender) {
        mUSDC = _mUSDC;
        comptroller = _comptroller;
        activeVenue = address(_mUSDC);

        // Enter the mUSDC market to use it as collateral and participate in Moonwell lending
        address[] memory markets = new address[](1);
        markets[0] = address(mUSDC);
        comptroller.enterMarkets(markets);
    }

    /**
     * @notice Set the keeper address.
     */
    function setKeeper(address _keeper) external onlyOwner {
        emit KeeperUpdated(keeper, _keeper);
        keeper = _keeper;
    }

    /**
     * @notice Get the vault safety health factor.
     *         Calculated as: (Collateral Value in USD / Borrowed Value in USD).
     *         Returns type(uint256).max if there is no outstanding debt.
     *         Scaled by 1e18 (where 1.0 * 1e18 is the liquidation threshold).
     */
    function getHealthFactor() public view returns (uint256) {
        uint256 borrowed = mUSDC.borrowBalanceStored(address(this));
        if (borrowed == 0) {
            return type(uint256).max;
        }

        uint256 mTokenBalance = mUSDC.balanceOf(address(this));
        uint256 exchangeRate = mUSDC.exchangeRateStored();
        uint256 supplied = (mTokenBalance * exchangeRate) / 1e18;

        address oracleAddress = comptroller.oracle();
        uint256 price = IPriceOracle(oracleAddress).getUnderlyingPrice(address(mUSDC));
        (, uint256 cf, ) = comptroller.markets(address(mUSDC));

        // supplied has 6 decimals, price has 30 decimals. (supplied * price) / 1e18 scales USD value to 1e18 decimals
        uint256 suppliedUSD = (supplied * price) / 1e18;
        uint256 collateralUSD = (suppliedUSD * cf) / 1e18;

        // borrowed has 6 decimals, multiply by 1e12 to scale to 1e18 decimals
        uint256 borrowedUSD = borrowed * 1e12;

        return (collateralUSD * 1e18) / borrowedUSD;
    }

    /**
     * @notice Total underlying USDC assets managed by this vault.
     *         Routes based on activeVenue.
     */
    function totalAssets() public view override returns (uint256) {
        uint256 cash = IERC20(asset()).balanceOf(address(this));

        if (activeVenue == address(mUSDC)) {
            uint256 mTokenBalance = mUSDC.balanceOf(address(this));
            uint256 exchangeRate = mUSDC.exchangeRateStored();
            uint256 supplied = (mTokenBalance * exchangeRate) / 1e18;
            uint256 borrowed = mUSDC.borrowBalanceStored(address(this));
            return cash + supplied - borrowed;
        } else if (activeVenue != address(0)) {
            // We hold shares in secondary vault
            uint256 shares = IERC20(activeVenue).balanceOf(address(this));
            uint256 venueAssets = CustomInterfaces.IERC4626(activeVenue).convertToAssets(shares);
            return cash + venueAssets;
        }

        return cash;
    }

    /* ================= Overrides for Interest Accrual ================= */

    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        if (activeVenue == address(mUSDC)) {
            mUSDC.exchangeRateCurrent();
        }
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override returns (uint256) {
        if (activeVenue == address(mUSDC)) {
            mUSDC.exchangeRateCurrent();
        }
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        if (activeVenue == address(mUSDC)) {
            mUSDC.exchangeRateCurrent();
        }
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        if (activeVenue == address(mUSDC)) {
            mUSDC.exchangeRateCurrent();
        }
        return super.redeem(shares, receiver, owner);
    }

    /* ================= ERC-4626 Core Flow Overrides ================= */

    /**
     * @notice Override deposit flow to supply USDC to the active venue.
     */
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);

        if (assets > 0) {
            if (activeVenue == address(mUSDC)) {
                IERC20(asset()).forceApprove(address(mUSDC), assets);
                uint256 result = mUSDC.mint(assets);
                if (result != 0) {
                    revert("Moonwell supply failed");
                }
            } else if (activeVenue != address(0)) {
                IERC20(asset()).forceApprove(activeVenue, assets);
                CustomInterfaces.IERC4626(activeVenue).deposit(assets, address(this));
            }
        }
    }

    /**
     * @notice Override withdraw flow to redeem USDC from the active venue if cash is insufficient.
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        uint256 cash = IERC20(asset()).balanceOf(address(this));
        if (cash < assets) {
            uint256 deficit = assets - cash;

            if (activeVenue == address(mUSDC)) {
                uint256 result = mUSDC.redeemUnderlying(deficit);
                if (result != 0) {
                    revert("Moonwell redeem underlying failed");
                }
            } else if (activeVenue != address(0)) {
                CustomInterfaces.IERC4626(activeVenue).withdraw(deficit, address(this), address(this));
            }
        }

        super._withdraw(caller, receiver, owner, assets, shares);
    }

    /* ================= Leverage Loop (Manual & Keeper) ================= */

    /**
     * @notice Leverage the vault's assets on Moonwell.
     *         Supplies collateral, borrows USDC, resupplies, and repeats.
     *         Callable only by the owner or keeper.
     */
    function leverage(uint256 targetLTV, uint256 numLoops) external onlyKeeperOrOwner {
        require(activeVenue == address(mUSDC), "Active venue is not Moonwell");
        require(targetLTV < 0.8 * 1e18, "Target LTV exceeds safe threshold");

        mUSDC.exchangeRateCurrent();

        for (uint256 i = 0; i < numLoops; i++) {
            uint256 mTokenBalance = mUSDC.balanceOf(address(this));
            uint256 exchangeRate = mUSDC.exchangeRateStored();
            uint256 supplied = (mTokenBalance * exchangeRate) / 1e18;
            uint256 borrowed = mUSDC.borrowBalanceCurrent(address(this));

            uint256 targetBorrow = (supplied * targetLTV) / 1e18;

            if (targetBorrow > borrowed) {
                uint256 amountToBorrow = targetBorrow - borrowed;

                uint256 errBorrow = mUSDC.borrow(amountToBorrow);
                if (errBorrow != 0) {
                    revert("Moonwell borrow failed");
                }

                IERC20(asset()).forceApprove(address(mUSDC), amountToBorrow);

                uint256 errSupply = mUSDC.mint(amountToBorrow);
                if (errSupply != 0) {
                    revert("Moonwell supply failed");
                }
            } else {
                break;
            }
        }
    }

    /**
     * @notice Deleverage/unwind the vault's position on Moonwell.
     *         Redeems underlying assets and repays debt recursively.
     *         Callable only by the owner or keeper.
     */
    function unwind(uint256 targetLTV, uint256 numLoops) public onlyKeeperOrOwner {
        require(activeVenue == address(mUSDC), "Active venue is not Moonwell");

        mUSDC.exchangeRateCurrent();

        address oracleAddress = comptroller.oracle();
        IPriceOracle oracle = IPriceOracle(oracleAddress);

        for (uint256 i = 0; i < numLoops; i++) {
            uint256 mTokenBalance = mUSDC.balanceOf(address(this));
            uint256 exchangeRate = mUSDC.exchangeRateStored();
            uint256 supplied = (mTokenBalance * exchangeRate) / 1e18;
            uint256 borrowed = mUSDC.borrowBalanceCurrent(address(this));

            uint256 targetBorrow = (supplied * targetLTV) / 1e18;

            if (borrowed > targetBorrow) {
                uint256 debtToRepay = borrowed - targetBorrow;

                (, uint256 liquidity, uint256 shortfall) = comptroller.getAccountLiquidity(address(this));
                require(shortfall == 0, "Shortfall in account liquidity");
                if (liquidity == 0) {
                    break;
                }

                uint256 price = oracle.getUnderlyingPrice(address(mUSDC));
                require(price > 0, "Oracle price query failed");

                uint256 withdrawableUSDC = (liquidity * 1e18) / price;
                uint256 amountToWithdraw = (withdrawableUSDC * 99) / 100;

                if (amountToWithdraw > debtToRepay) {
                    amountToWithdraw = debtToRepay;
                }

                if (amountToWithdraw == 0) {
                    break;
                }

                uint256 errRedeem = mUSDC.redeemUnderlying(amountToWithdraw);
                if (errRedeem != 0) {
                    revert("Moonwell redeem failed");
                }

                IERC20(asset()).forceApprove(address(mUSDC), amountToWithdraw);

                uint256 errRepay = mUSDC.repayBorrow(amountToWithdraw);
                if (errRepay != 0) {
                    revert("Moonwell repay failed");
                }
            } else {
                break;
            }
        }
    }

    /* ================= Yield Venue Migration ================= */

    /**
     * @notice Migrate the vault's assets to a new yield venue (e.g., Morpho or Moonwell).
     *         Callable only by the owner or keeper.
     */
    function migrate(address newVenue) external onlyKeeperOrOwner {
        require(newVenue != address(0), "Invalid new venue address");
        if (newVenue == activeVenue) {
            return;
        }

        address oldVenue = activeVenue;

        // 1. If currently in Moonwell, fully unwind leverage and redeem all collateral
        if (oldVenue == address(mUSDC)) {
            // Unwind debt completely
            uint256 borrowed = mUSDC.borrowBalanceCurrent(address(this));
            if (borrowed > 0) {
                unwind(0, 10);
            }

            // Redeem all remaining mUSDC
            uint256 mTokenBalance = mUSDC.balanceOf(address(this));
            if (mTokenBalance > 0) {
                uint256 err = mUSDC.redeem(mTokenBalance);
                if (err != 0) {
                    revert("Moonwell redeem failed during migration");
                }
            }
        } else {
            // Migrating from an ERC4626 vault (e.g. Morpho)
            uint256 shares = IERC20(oldVenue).balanceOf(address(this));
            if (shares > 0) {
                CustomInterfaces.IERC4626(oldVenue).redeem(shares, address(this), address(this));
            }
        }

        // 2. Deposit all freed USDC into the new yield venue
        uint256 cash = IERC20(asset()).balanceOf(address(this));
        if (cash > 0) {
            if (newVenue == address(mUSDC)) {
                // Supply to Moonwell
                IERC20(asset()).forceApprove(address(mUSDC), cash);
                uint256 err = mUSDC.mint(cash);
                if (err != 0) {
                    revert("Moonwell supply failed during migration");
                }
            } else {
                // Deposit into new ERC4626 vault
                IERC20(asset()).forceApprove(newVenue, cash);
                CustomInterfaces.IERC4626(newVenue).deposit(cash, address(this));
            }
        }

        activeVenue = newVenue;
        emit MigrationExecuted(oldVenue, newVenue, cash);
    }
}
