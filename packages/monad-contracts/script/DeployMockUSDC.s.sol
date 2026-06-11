// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console } from "forge-std/Script.sol";

import { MockUSDC } from "../src/mocks/MockUSDC.sol";

/**
 * @title DeployMockUSDC
 * @notice Deploys MockUSDC to Monad testnet. The broadcaster becomes `owner`
 *         (sole minter). MockUSDC reverts on Monad mainnet (chainid 143), so
 *         this script is testnet-only by construction (audit COM-018).
 *
 * Usage (encrypted keystore per .env.example convention):
 *
 *   forge script script/DeployMockUSDC.s.sol:DeployMockUSDC \
 *     --rpc-url monad_testnet --account comadre-deployer --broadcast
 *
 * After deploy:
 *   1. Set USDC_CONTRACT_ADDRESS=<address> in the repo-root .env.local.
 *   2. Mint test balances (6 decimals; 100 USDC = 100000000):
 *      cast send <address> "mint(address,uint256)" <to> 100000000 \
 *        --rpc-url https://testnet-rpc.monad.xyz --account comadre-deployer
 */
contract DeployMockUSDC is Script {
    function run() external returns (MockUSDC token) {
        vm.startBroadcast();
        token = new MockUSDC();
        vm.stopBroadcast();

        console.log("MockUSDC deployed at:", address(token));
        console.log("Owner (sole minter):", token.owner());
    }
}
