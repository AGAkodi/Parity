// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../src/interfaces/IMToken.sol";
import "../../src/interfaces/IComptroller.sol";
import "../../src/interfaces/IPriceOracle.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract MockMToken is ERC20 {
    address public immutable underlyingAsset;
    uint256 public mockExchangeRate = 1e18; // 1 mToken = 1 USDC by default
    uint256 public mockSupplyRate = 1585489599; // 5% APY per-second rate
    uint256 public mockBorrowRate = 2219785438; // 7% APY per-second rate
    uint256 public lastAccrualTimestamp;
    uint256 public borrowIndex = 1e18;

    mapping(address => uint256) public userBorrows;
    mapping(address => uint256) public accountBorrowIndex;

    constructor(address _underlying) ERC20("Mock Moonwell USDC", "mUSDC") {
        underlyingAsset = _underlying;
        lastAccrualTimestamp = block.timestamp;
    }

    function underlying() external view returns (address) {
        return underlyingAsset;
    }

    function _accrueInterest() internal {
        if (lastAccrualTimestamp == 0) {
            lastAccrualTimestamp = block.timestamp;
            return;
        }
        uint256 elapsed = block.timestamp - lastAccrualTimestamp;
        if (elapsed > 0) {
            if (mockSupplyRate > 0 && mockExchangeRate > 0) {
                uint256 supplyInterest = (mockExchangeRate * mockSupplyRate * elapsed) / 1e18;
                mockExchangeRate += supplyInterest;
            }
            if (mockBorrowRate > 0 && borrowIndex > 0) {
                uint256 borrowInterest = (borrowIndex * mockBorrowRate * elapsed) / 1e18;
                borrowIndex += borrowInterest;
            }
            lastAccrualTimestamp = block.timestamp;
        }
    }

    function _accrueAccountInterest(address account) internal {
        _accrueInterest();
        if (account == address(0)) return;
        if (userBorrows[account] > 0) {
            if (accountBorrowIndex[account] > 0 && borrowIndex > accountBorrowIndex[account]) {
                userBorrows[account] = (userBorrows[account] * borrowIndex) / accountBorrowIndex[account];
            }
        }
        accountBorrowIndex[account] = borrowIndex;
    }

    function accrueInterest() external returns (uint256) {
        _accrueInterest();
        return 0;
    }

    function setExchangeRate(uint256 rate) external {
        _accrueInterest();
        mockExchangeRate = rate;
    }

    function setSupplyRate(uint256 rate) external {
        _accrueInterest();
        mockSupplyRate = rate;
    }

    function setBorrowRate(uint256 rate) external {
        _accrueInterest();
        mockBorrowRate = rate;
    }

    function exchangeRateStored() public view returns (uint256) {
        return mockExchangeRate;
    }

    function exchangeRateCurrent() external returns (uint256) {
        _accrueInterest();
        return mockExchangeRate;
    }

    function supplyRatePerTimestamp() external view returns (uint256) {
        return mockSupplyRate;
    }

    function borrowRatePerTimestamp() external view returns (uint256) {
        return mockBorrowRate;
    }

    function supplyRatePerBlock() external view returns (uint256) {
        return mockSupplyRate / 5; // dummy conversion
    }

    function borrowRatePerBlock() external view returns (uint256) {
        return mockBorrowRate / 5; // dummy conversion
    }

    function mint(uint256 mintAmount) external returns (uint256) {
        _accrueInterest();
        require(ERC20(underlyingAsset).transferFrom(msg.sender, address(this), mintAmount), "USDC transfer failed");
        uint256 mTokensToMint = (mintAmount * 1e18) / mockExchangeRate;
        _mint(msg.sender, mTokensToMint);
        return 0; // Compound success code
    }

    function redeem(uint256 redeemTokens) external returns (uint256) {
        _accrueInterest();
        uint256 underlyingAmount = (redeemTokens * mockExchangeRate) / 1e18;
        _burn(msg.sender, redeemTokens);
        require(ERC20(underlyingAsset).transfer(msg.sender, underlyingAmount), "USDC transfer failed");
        return 0; // Compound success code
    }

    function redeemUnderlying(uint256 redeemAmount) external returns (uint256) {
        _accrueInterest();
        uint256 mTokensToBurn = (redeemAmount * 1e18) / mockExchangeRate;
        _burn(msg.sender, mTokensToBurn);
        require(ERC20(underlyingAsset).transfer(msg.sender, redeemAmount), "USDC transfer failed");
        return 0; // Compound success code
    }

    function borrow(uint256 borrowAmount) external returns (uint256) {
        _accrueAccountInterest(msg.sender);
        userBorrows[msg.sender] += borrowAmount;
        require(ERC20(underlyingAsset).transfer(msg.sender, borrowAmount), "USDC transfer failed");
        return 0; // Compound success code
    }

    function repayBorrow(uint256 repayAmount) external returns (uint256) {
        _accrueAccountInterest(msg.sender);
        require(ERC20(underlyingAsset).transferFrom(msg.sender, address(this), repayAmount), "USDC transfer failed");
        if (repayAmount >= userBorrows[msg.sender]) {
            userBorrows[msg.sender] = 0;
        } else {
            userBorrows[msg.sender] -= repayAmount;
        }
        return 0; // Compound success code
    }

    function borrowBalanceStored(address account) external view returns (uint256) {
        return userBorrows[account];
    }

    function borrowBalanceCurrent(address account) external returns (uint256) {
        _accrueAccountInterest(account);
        return userBorrows[account];
    }

    function totalBorrows() external pure returns (uint256) {
        return 0;
    }

    function getCash() external view returns (uint256) {
        return ERC20(underlyingAsset).balanceOf(address(this));
    }

    function totalReserves() external pure returns (uint256) {
        return 0;
    }
}

contract MockComptroller {
    address public priceOracle;
    mapping(address => bool) public enteredMarkets;
    mapping(address => uint256) public collateralFactors; // scaled by 1e18

    // configurable account liquidity variables to simplify unit tests
    mapping(address => uint256) public mockLiquidity;
    mapping(address => uint256) public mockShortfall;
    address public mUSDCAddress;

    constructor() {
        collateralFactors[address(0)] = 0.8 * 1e18; // default 80% collateral factor
    }

    function setOracle(address _oracle) external {
        priceOracle = _oracle;
    }

    function setMToken(address _mUSDC) external {
        mUSDCAddress = _mUSDC;
    }

    function setCollateralFactor(address mToken, uint256 factor) external {
        collateralFactors[mToken] = factor;
    }

    function setAccountLiquidity(address account, uint256 liquidity, uint256 shortfall) external {
        mockLiquidity[account] = liquidity;
        mockShortfall[account] = shortfall;
    }

    function enterMarkets(address[] calldata mTokens) external returns (uint256[] memory) {
        uint256[] memory results = new uint256[](mTokens.length);
        for (uint256 i = 0; i < mTokens.length; i++) {
            enteredMarkets[mTokens[i]] = true;
            results[i] = 0;
        }
        return results;
    }

    function exitMarket(address mToken) external returns (uint256) {
        enteredMarkets[mToken] = false;
        return 0;
    }

    function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256) {
        if (mockLiquidity[account] > 0 || mockShortfall[account] > 0) {
            return (0, mockLiquidity[account], mockShortfall[account]);
        }

        if (mUSDCAddress == address(0)) {
            return (0, 0, 0);
        }

        uint256 mTokenBalance = ERC20(mUSDCAddress).balanceOf(account);
        uint256 exchangeRate = MockMToken(mUSDCAddress).exchangeRateStored();
        uint256 cf = collateralFactors[mUSDCAddress];
        if (cf == 0) cf = 0.8 * 1e18;

        uint256 suppliedUSD = (mTokenBalance * exchangeRate * 1e12) / 1e18;
        uint256 collateralUSD = (suppliedUSD * cf) / 1e18;
        uint256 borrowedUSD = MockMToken(mUSDCAddress).borrowBalanceStored(account) * 1e12;

        if (collateralUSD > borrowedUSD) {
            return (0, collateralUSD - borrowedUSD, 0);
        } else {
            return (0, 0, borrowedUSD - collateralUSD);
        }
    }

    function markets(address mToken) external view returns (bool, uint256, bool) {
        uint256 cf = collateralFactors[mToken];
        if (cf == 0) cf = 0.8 * 1e18; // fallback to 80%
        return (true, cf, true);
    }

    function oracle() external view returns (address) {
        return priceOracle;
    }
}

contract MockOracle {
    mapping(address => uint256) public underlyingPrices;

    function setPrice(address mToken, uint256 price) external {
        underlyingPrices[mToken] = price;
    }

    function getUnderlyingPrice(address mToken) external view returns (uint256) {
        uint256 price = underlyingPrices[mToken];
        if (price == 0) price = 1e30; // default to $1.00 scaled to 30 decimals for USDC
        return price;
    }
}

contract MockMorphoVault is ERC20 {
    address public immutable assetToken;

    constructor(address _asset) ERC20("Mock Morpho Moonwell Flagship USDC", "mwUSDC") {
        assetToken = _asset;
    }

    function asset() external view returns (address) {
        return assetToken;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function totalAssets() public view returns (uint256) {
        return ERC20(assetToken).balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public pure returns (uint256) {
        return assets;
    }

    function convertToAssets(uint256 shares) public pure returns (uint256) {
        return shares;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        require(ERC20(assetToken).transferFrom(msg.sender, address(this), assets), "USDC transfer failed");
        _mint(receiver, assets);
        return assets;
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256) {
        _burn(owner, shares);
        require(ERC20(assetToken).transfer(receiver, shares), "USDC transfer failed");
        return shares;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256) {
        _burn(owner, assets);
        require(ERC20(assetToken).transfer(receiver, assets), "USDC transfer failed");
        return assets;
    }
}
