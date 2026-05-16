// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Mintable ERC-20 with 6 decimals (USDC convention) for Monad testnet
 *         and forge tests. Mint is owner-gated AND chain-gated: the contract
 *         cannot be deployed or minted on Monad mainnet (chainid 143). See
 *         audit COM-018.
 */
contract MockUSDC is ERC20 {
    address public immutable owner;

    error NotOwner();
    error MainnetBlocked();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier notMainnet() {
        if (block.chainid == 143) revert MainnetBlocked();
        _;
    }

    constructor() ERC20("Mock USDC", "mUSDC") notMainnet {
        owner = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner notMainnet {
        _mint(to, amount);
    }
}
