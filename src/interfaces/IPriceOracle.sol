// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPriceOracle {
    /**
     * @notice Get the underlying price of a cToken (mToken) asset
     * @param mToken The cToken/mToken to get the underlying price of
     * @return The underlying asset price in USD, scaled by 10 ** (36 - underlyingDecimals).
     *         For USDC (6 decimals), returns price scaled by 10**30.
     *         For WETH (18 decimals), returns price scaled by 10**18.
     */
    function getUnderlyingPrice(address mToken) external view returns (uint256);
}
