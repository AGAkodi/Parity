// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

interface IERC4626 is IERC20 {
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    /**
     * @notice Address of the underlying token that the Vault manages
     */
    function asset() external view returns (address assetTokenAddress);

    /**
     * @notice Total amount of underlying assets managed by the Vault
     */
    function totalAssets() external view returns (uint256 totalManagedAssets);

    /**
     * @notice Convert a given amount of underlying assets into vault shares
     */
    function convertToShares(uint256 assets) external view returns (uint256 shares);

    /**
     * @notice Convert a given amount of vault shares into underlying assets
     */
    function convertToAssets(uint256 shares) external view returns (uint256 assets);

    /**
     * @notice Maximum assets that can be deposited in a single call
     */
    function maxDeposit(address receiver) external view returns (uint256 maxAssets);

    /**
     * @notice Preview the amount of shares that would be returned for a deposit
     */
    function previewDeposit(uint256 assets) external view returns (uint256 shares);

    /**
     * @notice Deposit assets into the vault and mint shares to receiver
     */
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /**
     * @notice Maximum shares that can be minted in a single call
     */
    function maxMint(address receiver) external view returns (uint256 maxShares);

    /**
     * @notice Preview the amount of assets that would be required to mint a given number of shares
     */
    function previewMint(uint256 shares) external view returns (uint256 assets);

    /**
     * @notice Mint exactly shares of vault token to receiver by depositing underlying assets
     */
    function mint(uint256 shares, address receiver) external returns (uint256 assets);

    /**
     * @notice Maximum assets that can be withdrawn in a single call
     */
    function maxWithdraw(address owner) external view returns (uint256 maxAssets);

    /**
     * @notice Preview the amount of shares that would be burned to withdraw a given amount of assets
     */
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);

    /**
     * @notice Withdraw exactly assets from the vault, burning owner's shares and sending assets to receiver
     */
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);

    /**
     * @notice Maximum shares that can be redeemed in a single call
     */
    function maxRedeem(address owner) external view returns (uint256 maxShares);

    /**
     * @notice Preview the amount of assets that would be returned for a redemption of shares
     */
    function previewRedeem(uint256 shares) external view returns (uint256 assets);

    /**
     * @notice Redeem exactly shares of vault token, burning them and sending underlying assets to receiver
     */
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
}
