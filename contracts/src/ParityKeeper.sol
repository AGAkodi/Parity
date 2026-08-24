// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./ParityVault.sol";

contract ParityKeeper is Ownable, Pausable {
    ParityVault public immutable vault;
    address public keeper;

    event KeeperAction(
        string action,
        string reason,
        uint256 hfBefore,
        uint256 hfAfter,
        uint256 apySnapshot,
        uint256 timestamp
    );

    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);

    modifier onlyKeeper() {
        require(msg.sender == keeper, "Caller is not keeper");
        _;
    }

    constructor(
        address _vault,
        address _keeper
    ) Ownable(msg.sender) {
        vault = ParityVault(_vault);
        keeper = _keeper;
    }

    /**
     * @notice Set the keeper address.
     */
    function setKeeper(address _newKeeper) external onlyOwner {
        emit KeeperUpdated(keeper, _newKeeper);
        keeper = _newKeeper;
    }

    /**
     * @notice Pause keeper operations in case of emergency.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause keeper operations.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Rebalance vault to target LTV by increasing leverage loops.
     */
    function rebalance(
        uint256 targetLTV,
        uint256 numLoops,
        string calldata reason,
        uint256 apySnapshot
    ) external onlyKeeper whenNotPaused {
        uint256 hfBefore = vault.getHealthFactor();

        vault.leverage(targetLTV, numLoops);

        uint256 hfAfter = vault.getHealthFactor();

        emit KeeperAction("rebalance", reason, hfBefore, hfAfter, apySnapshot, block.timestamp);
    }

    /**
     * @notice Deleverage vault to target LTV (or 0 for safety).
     */
    function deleverage(
        uint256 targetLTV,
        uint256 numLoops,
        string calldata reason,
        uint256 apySnapshot
    ) external onlyKeeper whenNotPaused {
        uint256 hfBefore = vault.getHealthFactor();

        vault.unwind(targetLTV, numLoops);

        uint256 hfAfter = vault.getHealthFactor();

        emit KeeperAction("deleverage", reason, hfBefore, hfAfter, apySnapshot, block.timestamp);
    }

    /**
     * @notice Migrate the vault's assets to a new yield venue.
     */
    function migrate(
        address venue,
        string calldata reason,
        uint256 apySnapshot
    ) external onlyKeeper whenNotPaused {
        uint256 hfBefore = vault.getHealthFactor();

        vault.migrate(venue);

        uint256 hfAfter = vault.getHealthFactor();

        emit KeeperAction("migrate", reason, hfBefore, hfAfter, apySnapshot, block.timestamp);
    }
}
