// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMToken {
    /**
     * @notice Deposit underlying tokens and receive mTokens in return
     * @param mintAmount The amount of underlying token to supply
     * @return 0 on success, or an error code
     */
    function mint(uint256 mintAmount) external returns (uint256);

    /**
     * @notice Withdraw underlying tokens by specifying the amount of mTokens to redeem
     * @param redeemTokens The amount of mTokens to redeem
     * @return 0 on success, or an error code
     */
    function redeem(uint256 redeemTokens) external returns (uint256);

    /**
     * @notice Withdraw underlying tokens by specifying the amount of underlying tokens to receive
     * @param redeemAmount The amount of underlying tokens to redeem
     * @return 0 on success, or an error code
     */
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

    /**
     * @notice Borrow underlying tokens from the protocol
     * @param borrowAmount The amount of underlying token to borrow
     * @return 0 on success, or an error code
     */
    function borrow(uint256 borrowAmount) external returns (uint256);

    /**
     * @notice Repay borrow debt to the protocol
     * @param repayAmount The amount of underlying token to repay
     * @return 0 on success, or an error code
     */
    function repayBorrow(uint256 repayAmount) external returns (uint256);

    /**
     * @notice Get the mToken balance of the account
     */
    function balanceOf(address owner) external view returns (uint256);

    /**
     * @notice Retrieve the current borrow balance of the account, accruing interest first
     */
    function borrowBalanceCurrent(address account) external returns (uint256);

    /**
     * @notice Retrieve the stored borrow balance of the account (without interest accrual)
     */
    function borrowBalanceStored(address account) external view returns (uint256);

    /**
     * @notice Retrieve the exchange rate from underlying to mToken (scaled by 1e18)
     */
    function exchangeRateStored() external view returns (uint256);

    /**
     * @notice Accrues interest and retrieves the current exchange rate (scaled by 1e18)
     */
    function exchangeRateCurrent() external returns (uint256);

    /**
     * @notice Retrieve the underlying asset address
     */
    function underlying() external view returns (address);

    /**
     * @notice Returns the supply rate per timestamp (scaled by 1e18)
     */
    function supplyRatePerTimestamp() external view returns (uint256);

    /**
     * @notice Returns the borrow rate per timestamp (scaled by 1e18)
     */
    function borrowRatePerTimestamp() external view returns (uint256);

    /**
     * @notice Returns the supply rate per block (scaled by 1e18, if block-based interest is used)
     */
    function supplyRatePerBlock() external view returns (uint256);

    /**
     * @notice Returns the borrow rate per block (scaled by 1e18, if block-based interest is used)
     */
    function borrowRatePerBlock() external view returns (uint256);

    /**
     * @notice Returns total borrows outstanding
     */
    function totalBorrows() external view returns (uint256);

    /**
     * @notice Returns cash balance of the underlying asset held by the market
     */
    function getCash() external view returns (uint256);

    /**
     * @notice Returns total reserves of the market
     */
    function totalReserves() external view returns (uint256);
}
