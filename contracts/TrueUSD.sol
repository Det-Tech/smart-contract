pragma solidity ^0.4.23;

import "./modularERC20/ModularPausableToken.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./BurnableTokenWithBounds.sol";
import "./CompliantToken.sol";
import "./RedeemableToken.sol";
import "./DepositToken.sol";
import "./GasRefundToken.sol";
import "./TokenWithHook.sol";

/** @title TrueUSD
* @dev This is the top-level ERC20 contract, but most of the interesting functionality is
* inherited - see the documentation on the corresponding contracts.
*/
contract TrueUSD is 
ModularPausableToken, 
BurnableTokenWithBounds, 
CompliantToken,
RedeemableToken,
TokenWithHook,
DepositToken,
GasRefundToken {
    using SafeMath for *;

    uint8 public constant DECIMALS = 18;
    uint8 public constant ROUNDING = 2;

    event ChangeTokenName(string newName, string newSymbol);

    /**  
    *@dev set the totalSupply of the contract for delegation purposes
    Can only be set once.
    */
    function initialize(uint256 _totalSupply) public {
        require(!initialized, "already initialized");
        initialized = true;
        owner = msg.sender;
        totalSupply_ = _totalSupply;
        burnMin = 10000 * 10**uint256(DECIMALS);
        burnMax = 20000000 * 10**uint256(DECIMALS);
        name = "TrueUSD";
        symbol = "TUSD";
    }

    function changeTokenName(string _name, string _symbol) external onlyOwner {
        name = _name;
        symbol = _symbol;
        emit ChangeTokenName(_name, _symbol);
    }

    /**  
    *@dev send all eth balance in the TrueUSD contract to another address
    */
    function reclaimEther(address _to) external onlyOwner {
        _to.transfer(address(this).balance);
    }

    /**  
    *@dev send all token balance of an arbitary erc20 token
    in the TrueUSD contract to another address
    */
    function reclaimToken(ERC20 token, address _to) external onlyOwner {
        uint256 balance = token.balanceOf(this);
        token.transfer(_to, balance);
    }

    /**  
    *@dev allows owner of TrueUSD to gain ownership of any contract that TrueUSD currently owns
    */
    function reclaimContract(Ownable _ownable) external onlyOwner {
        _ownable.transferOwnership(owner);
    }

    function burnAllArgs(address _burner, uint256 _value) internal {
        //round down burn amount so that the lowest amount allowed is 1 cent
        uint burnAmount = _value.div(10 ** uint256(DECIMALS - ROUNDING)).mul(10 ** uint256(DECIMALS - ROUNDING));
        super.burnAllArgs(_burner, burnAmount);
    }
}
