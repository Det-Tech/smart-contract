pragma solidity 0.5.13;

pragma experimental ABIEncoderV2;

import "wjm-airswap-swap/contracts/Swap.sol";
import "wjm-airswap-transfers/contracts/TransferHandlerRegistry.sol";
import "wjm-airswap-transfers/contracts/handlers/ERC20TransferHandler.sol";
import "@trusttoken/trusttokens/contracts/StakedToken.sol";
import "@trusttoken/trusttokens/contracts/StakingOpportunityFactory.sol";
import "@trusttoken/trusttokens/contracts/Liquidator.sol";
import "@trusttoken/trusttokens/contracts/mocks/MockTrustToken.sol";
import "@trusttoken/trusttokens/contracts/mocks/MultisigLiquidatorMock.sol";
import { UnlockTrustTokens } from "@trusttoken/trusttokens/contracts/UnlockTrustTokens.sol";


contract Airswap is Swap {}

contract AirswapTransferHandlerRegistry is TransferHandlerRegistry {}

contract AirswapERC20TransferHandler is ERC20TransferHandler {}

contract TrustTokenDependencies is StakedToken {}

contract TrustTokenLiquidator is Liquidator {}

contract TrustTokenUnlockTrustTokens is UnlockTrustTokens {}