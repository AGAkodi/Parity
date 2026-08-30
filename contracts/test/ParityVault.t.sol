// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ParityVault.sol";
import "../src/ParityKeeper.sol";
import "./mocks/MockProtocol.sol";

contract ParityVaultTest is Test {
    ParityVault public vault;
    MockUSDC public usdc;
    MockMToken public mUSDC;
    MockComptroller public comptroller;
    MockOracle public oracle;

    address public alice = address(0x1111);
    address public bob = address(0x2222);

    function setUp() public {
        // Deploy mock contracts
        usdc = new MockUSDC();
        mUSDC = new MockMToken(address(usdc));
        comptroller = new MockComptroller();
        oracle = new MockOracle();

        // Configure Comptroller and Oracle
        comptroller.setOracle(address(oracle));
        comptroller.setMToken(address(mUSDC));
        comptroller.setCollateralFactor(address(mUSDC), 0.8 * 1e18);

        // Deploy ParityVault
        vault = new ParityVault(
            IERC20(address(usdc)),
            IMToken(address(mUSDC)),
            IComptroller(address(comptroller)),
            "Parity Vault",
            "prtUSDC"
        );

        // Fund test accounts with USDC
        usdc.mint(alice, 1000 * 1e6); // 1000 USDC
        usdc.mint(bob, 1000 * 1e6);   // 1000 USDC

        // Approve vault for USDC spending
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    function testInitialState() public view {
        assertEq(address(vault.asset()), address(usdc));
        assertEq(vault.totalAssets(), 0);
        assertEq(vault.decimals(), 6);
    }

    function testDeposit() public {
        uint256 depositAmount = 100 * 1e6; // 100 USDC

        vm.prank(alice);
        uint256 shares = vault.deposit(depositAmount, alice);

        // Verify share issuance (1:1 initially)
        assertEq(shares, 100 * 1e6);
        assertEq(vault.balanceOf(alice), 100 * 1e6);

        // Verify total assets
        assertEq(vault.totalAssets(), depositAmount);

        // Verify all USDC was supplied to Moonwell (vault should hold 0 USDC cash, and mUSDC instead)
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(mUSDC.balanceOf(address(vault)), 100 * 1e6); // exchange rate 1:1
    }

    function testWithdraw() public {
        uint256 depositAmount = 100 * 1e6;
        uint256 withdrawAmount = 40 * 1e6;

        vm.prank(alice);
        vault.deposit(depositAmount, alice);

        vm.prank(alice);
        uint256 sharesBurned = vault.withdraw(withdrawAmount, alice, alice);

        // Verify shares burned (1:1 initially)
        assertEq(sharesBurned, 40 * 1e6);
        assertEq(vault.balanceOf(alice), 60 * 1e6);

        // Verify USDC balance of alice
        assertEq(usdc.balanceOf(alice), (1000 - 100 + 40) * 1e6); // 940 USDC

        // Verify vault total assets
        assertEq(vault.totalAssets(), 60 * 1e6);
        assertEq(mUSDC.balanceOf(address(vault)), 60 * 1e6);
    }

    function testYieldAccrual() public {
        uint256 depositAmount = 100 * 1e6;

        vm.prank(alice);
        vault.deposit(depositAmount, alice);

        // Simulate 10% interest earned on Moonwell by increasing the exchange rate to 1.10
        mUSDC.setExchangeRate(1.1 * 1e18);

        // Verify total assets are now 110 USDC
        assertEq(vault.totalAssets(), 110 * 1e6);

        // Bob deposits 110 USDC. Since share price is 1.10, he should get 100 shares.
        vm.prank(bob);
        uint256 bobShares = vault.deposit(110 * 1e6, bob);
        assertEq(bobShares, 100 * 1e6);

        // Verify new total assets
        assertEq(vault.totalAssets(), 220 * 1e6);

        // Alice redeems all her shares (100 shares) and should get 110 USDC.
        vm.prank(alice);
        uint256 aliceAssets = vault.redeem(100 * 1e6, alice, alice);
        assertApproxEqAbs(aliceAssets, 110 * 1e6, 1);

        // Verify final USDC balances (approx within 1 wei due to ERC-4626 virtual share offsets)
        assertApproxEqAbs(usdc.balanceOf(alice), (1000 - 100 + 110) * 1e6, 1); // 1010 USDC
        assertEq(usdc.balanceOf(bob), (1000 - 110) * 1e6);         // 890 USDC
    }

    function testWithdrawWithDeficitRedemption() public {
        // Vault has 100 USDC supplied to Moonwell
        vm.prank(alice);
        vault.deposit(100 * 1e6, alice);

        // Simulate vault directly receiving 20 USDC cash (e.g. transfer yield/donation)
        usdc.mint(address(vault), 20 * 1e6);

        // Now totalAssets = 120 USDC (20 cash, 100 Moonwell)
        assertEq(vault.totalAssets(), 120 * 1e6);

        // Alice withdraws 50 USDC. 
        // Vault cash (20) is less than withdraw amount (50), so it should redeem the deficit (30 USDC) from Moonwell.
        vm.prank(alice);
        vault.withdraw(50 * 1e6, alice, alice);

        // Verify final state:
        // Alice balance = 1000 (starting) - 100 (deposit) + 50 (withdraw) = 950 USDC
        assertEq(usdc.balanceOf(alice), 950 * 1e6);

        // Vault should have 0 cash left (20 cash + 30 redeemed - 50 withdrawn = 0)
        assertEq(usdc.balanceOf(address(vault)), 0);

        // Vault Moonwell balance should be 70 USDC (100 - 30 redeemed = 70)
        assertEq(mUSDC.balanceOf(address(vault)), 70 * 1e6);
    }

    function testLeverageLoop() public {
        uint256 depositAmount = 100 * 1e6; // 100 USDC
        
        vm.prank(alice);
        vault.deposit(depositAmount, alice);

        // Owner calls leverage targeting 70% LTV, with 5 loops
        vault.leverage(0.7 * 1e18, 5);

        uint256 supplied = (mUSDC.balanceOf(address(vault)) * mUSDC.exchangeRateStored()) / 1e18;
        uint256 borrowed = mUSDC.borrowBalanceStored(address(vault));
        uint256 totalAssetsVal = vault.totalAssets();

        console.log("Leveraged Supplied Collateral:", supplied);
        console.log("Leveraged Borrowed Debt:", borrowed);
        console.log("Leveraged Total Assets (Net Equity):", totalAssetsVal);

        // Net assets should still be exactly 100 USDC (Alice's principal)
        assertEq(totalAssetsVal, 100 * 1e6);

        // Verify LTV is close to target (70%)
        // LTV = borrowed / supplied
        uint256 actualLTV = (borrowed * 1e18) / supplied;
        assertApproxEqAbs(actualLTV, 0.7 * 1e18, 0.05 * 1e18); // within 5% LTV tolerance (5 loops converges to ~66%)
    }

    function testUnwindLoop() public {
        uint256 depositAmount = 100 * 1e6; // 100 USDC
        
        vm.prank(alice);
        vault.deposit(depositAmount, alice);

        // Loop up to 70% LTV
        vault.leverage(0.7 * 1e18, 5);

        // Verify debt was created
        uint256 borrowedBefore = mUSDC.borrowBalanceStored(address(vault));
        assertTrue(borrowedBefore > 0);

        // Unwind back to 0% LTV (full deleverage)
        vault.unwind(0, 5);

        uint256 suppliedAfter = (mUSDC.balanceOf(address(vault)) * mUSDC.exchangeRateStored()) / 1e18;
        uint256 borrowedAfter = mUSDC.borrowBalanceStored(address(vault));
        uint256 totalAssetsVal = vault.totalAssets();

        // Debt should be fully unwound to 0
        assertEq(borrowedAfter, 0);

        // Collateral should be back to 100 USDC (Alice's principal)
        assertEq(suppliedAfter, 100 * 1e6);
        assertEq(totalAssetsVal, 100 * 1e6);

        // Alice should be able to withdraw all her funds successfully now
        vm.prank(alice);
        vault.withdraw(100 * 1e6, alice, alice);

        assertEq(usdc.balanceOf(alice), 1000 * 1e6); // Back to starting balance!
        assertEq(vault.totalAssets(), 0);
    }

    function testLeverageAccessControl() public {
        uint256 depositAmount = 100 * 1e6; // 100 USDC
        
        vm.prank(alice);
        vault.deposit(depositAmount, alice);

        // Alice calls leverage directly (should revert as she is not owner)
        vm.prank(alice);
        vm.expectRevert("Caller is not keeper or owner");
        vault.leverage(0.7 * 1e18, 5);

        // Alice calls unwind directly (should revert)
        vm.prank(alice);
        vm.expectRevert("Caller is not keeper or owner");
        vault.unwind(0, 5);
    }

    function testKeeperRebalanceAndDeleverage() public {
        // Deploy Keeper Contract
        address keeperWallet = address(0x9999);
        ParityKeeper keeper = new ParityKeeper(address(vault), keeperWallet);

        // Authorize Keeper Contract on the Vault
        vault.setKeeper(address(keeper));

        // Alice deposits 100 USDC
        vm.prank(alice);
        vault.deposit(100 * 1e6, alice);

        // Prank as keeperWallet to call keeper contract rebalance
        vm.prank(keeperWallet);
        keeper.rebalance(0.7 * 1e18, 5, "rebalance to 70% LTV", 0.05 * 1e18);

        uint256 supplied = (mUSDC.balanceOf(address(vault)) * mUSDC.exchangeRateStored()) / 1e18;
        uint256 borrowed = mUSDC.borrowBalanceStored(address(vault));
        assertEq(vault.totalAssets(), 100 * 1e6);
        assertApproxEqAbs((borrowed * 1e18) / supplied, 0.7 * 1e18, 0.05 * 1e18);

        // Prank as keeperWallet to call keeper contract deleverage back to 0
        vm.prank(keeperWallet);
        keeper.deleverage(0, 5, "market risk", 0);

        assertEq(mUSDC.borrowBalanceStored(address(vault)), 0);
        assertEq(vault.totalAssets(), 100 * 1e6);
    }

    function testKeeperMigration() public {
        address keeperWallet = address(0x9999);
        ParityKeeper keeper = new ParityKeeper(address(vault), keeperWallet);
        vault.setKeeper(address(keeper));

        // Deploy Mock Morpho Vault
        MockMorphoVault morpho = new MockMorphoVault(address(usdc));

        // Alice deposits 100 USDC
        vm.prank(alice);
        vault.deposit(100 * 1e6, alice);

        // Keeper leverages position to 70%
        vm.prank(keeperWallet);
        keeper.rebalance(0.7 * 1e18, 5, "rebalance first", 0.05 * 1e18);

        // Migrate to Morpho
        vm.prank(keeperWallet);
        keeper.migrate(address(morpho), "migrate to Morpho flagship", 0.06 * 1e18);

        // Verify active venue is Morpho and balances are routed
        assertEq(vault.activeVenue(), address(morpho));
        assertEq(mUSDC.borrowBalanceStored(address(vault)), 0);
        assertEq(mUSDC.balanceOf(address(vault)), 0);
        assertEq(morpho.balanceOf(address(vault)), 100 * 1e6);
        assertEq(vault.totalAssets(), 100 * 1e6);

        // Verify withdraw still works via Morpho
        vm.prank(alice);
        vault.withdraw(40 * 1e6, alice, alice);

        assertEq(usdc.balanceOf(alice), (1000 - 100 + 40) * 1e6);
        assertEq(morpho.balanceOf(address(vault)), 60 * 1e6);
        assertEq(vault.totalAssets(), 60 * 1e6);

        // Migrate back to Moonwell
        vm.prank(keeperWallet);
        keeper.migrate(address(mUSDC), "migrate back to Moonwell", 0.04 * 1e18);

        assertEq(vault.activeVenue(), address(mUSDC));
        assertEq(morpho.balanceOf(address(vault)), 0);
        assertEq(mUSDC.balanceOf(address(vault)), 60 * 1e6);
        assertEq(vault.totalAssets(), 60 * 1e6);
    }

    function testKeeperAccessControlAndPausing() public {
        address keeperWallet = address(0x9999);
        ParityKeeper keeper = new ParityKeeper(address(vault), keeperWallet);
        vault.setKeeper(address(keeper));

        // 1. Verify access control on keeper contract (non-keeper calling should revert)
        vm.prank(alice);
        vm.expectRevert("Caller is not keeper");
        keeper.rebalance(0.7 * 1e18, 5, "rebalance", 0.05 * 1e18);

        // 2. Verify vault-level keeper check: if keeper is not authorized on vault
        ParityKeeper unauthorizedKeeper = new ParityKeeper(address(vault), alice);
        // unauthorizedKeeper's keeper is Alice. If Alice calls, keeper contract check passes,
        // but when it calls vault, it will revert because vault doesn't recognize unauthorizedKeeper contract as keeper!
        vm.prank(alice);
        vm.expectRevert("Caller is not keeper or owner");
        unauthorizedKeeper.rebalance(0.7 * 1e18, 5, "rebalance", 0.05 * 1e18);

        // 3. Verify Pausing/Circuit Breaker
        keeper.pause();
        assertTrue(keeper.paused());

        vm.prank(keeperWallet);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        keeper.rebalance(0.7 * 1e18, 5, "rebalance", 0.05 * 1e18);

        // Unpause and verify it works again
        keeper.unpause();
        assertFalse(keeper.paused());
    }

    function testTimeBasedSupplyAccrual() public {
        // Provide liquidity to mUSDC so it can pay interest on redemption
        usdc.mint(address(mUSDC), 1000 * 1e6);

        uint256 depositAmount = 100 * 1e6; // 100 USDC
        vm.prank(alice);
        vault.deposit(depositAmount, alice);

        uint256 initialAssets = vault.totalAssets();
        assertEq(initialAssets, 100 * 1e6);

        // Advance time by 30 days (2,592,000 seconds)
        vm.warp(block.timestamp + 30 days);

        // Calling exchangeRateCurrent accrues interest
        uint256 rateAfter30Days = mUSDC.exchangeRateCurrent();
        assertTrue(rateAfter30Days > 1e18);

        // Vault totalAssets should now reflect the accrued interest
        uint256 accruedAssets = vault.totalAssets();
        assertTrue(accruedAssets > initialAssets);

        // Alice redeems her shares and gets principal + accrued interest
        vm.prank(alice);
        uint256 receivedAssets = vault.redeem(100 * 1e6, alice, alice);
        assertTrue(receivedAssets > 100 * 1e6);
        assertApproxEqAbs(receivedAssets, accruedAssets, 1);
    }

    function testTimeBasedBorrowAccrual() public {
        // Fund mUSDC with liquidity so borrowing works
        usdc.mint(address(mUSDC), 500 * 1e6);

        // Alice approves mUSDC and deposits collateral
        vm.startPrank(alice);
        usdc.approve(address(mUSDC), type(uint256).max);
        mUSDC.mint(100 * 1e6);

        // Alice borrows 50 USDC
        mUSDC.borrow(50 * 1e6);
        vm.stopPrank();

        uint256 initialBorrow = mUSDC.borrowBalanceStored(alice);
        assertEq(initialBorrow, 50 * 1e6);

        // Advance time by 30 days
        vm.warp(block.timestamp + 30 days);

        // borrowBalanceStored remains previous until accrual
        assertEq(mUSDC.borrowBalanceStored(alice), 50 * 1e6);

        // borrowBalanceCurrent triggers accrual and returns increased debt
        uint256 accruedBorrow = mUSDC.borrowBalanceCurrent(alice);
        assertTrue(accruedBorrow > initialBorrow);

        // borrowBalanceStored now reflects the accrued borrow
        assertEq(mUSDC.borrowBalanceStored(alice), accruedBorrow);
    }

    function testRateChangePreservesPriorAccrual() public {
        uint256 initialRate = mUSDC.exchangeRateStored();
        assertEq(initialRate, 1e18);

        // Advance time by 10 days
        vm.warp(block.timestamp + 10 days);

        // Change supply rate to 10% APY
        uint256 newRate = 3170979198;
        mUSDC.setSupplyRate(newRate);

        // Exchange rate should have accrued the 10 days of interest at the old rate
        uint256 rateAfterChange = mUSDC.exchangeRateStored();
        assertTrue(rateAfterChange > initialRate);
        assertEq(mUSDC.supplyRatePerTimestamp(), newRate);

        // Advance time by another 10 days
        vm.warp(block.timestamp + 10 days);

        uint256 finalRate = mUSDC.exchangeRateCurrent();
        assertTrue(finalRate > rateAfterChange);
    }
}
