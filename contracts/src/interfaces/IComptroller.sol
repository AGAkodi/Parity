// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IComptroller {
    /**
     * @notice Add assets to be included in account liquidity calculations
     * @param mTokens The list of mToken market addresses to be enabled
     * @return Returns a list of error codes indicating success (0) or failure for each market
     */
    function enterMarkets(address[] calldata mTokens) external returns (uint256[] memory);

    /**
     * @notice Remove an asset from the sender's account liquidity calculation
     * @param mToken The address of the mToken market to be disabled
     * @return 0 on success, or an error code
     */
    function exitMarket(address mToken) external returns (uint256);

    /**
     * @notice Determine what the account liquidity limits are for the given account
     * @param account The account to check liquidity for
     * @return (error, liquidity, shortfall)
     *         error: 0 on success, or an error code
     *         liquidity: collateral value in excess of borrow requirements (in USD, scaled by 1e18)
     *         shortfall: borrow value in excess of collateral requirements (in USD, scaled by 1e18)
     */
    function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256);

    /**
     * @notice Return the metadata for a given market
     * @param mToken The market address
     * @return (isListed, collateralFactorMantissa, isComped)
     */
    function markets(address mToken) external view returns (bool, uint256, bool);

    /**
     * @notice Get the active price oracle contract address
     */
    function oracle() external view returns (address);
}
