pragma solidity ^0.4.21;

import "./modularERC20/ModularBurnableToken.sol";
import "./DelegateBurnable.sol";
import "./modularERC20/ModularStandardToken.sol";

contract StandardDelegate is DelegateBurnable, ModularStandardToken, ModularBurnableToken {
    address public delegatedFrom;

    event DelegatedFromSet(address addr);

    modifier onlySender(address _source) {
        require(msg.sender == _source);
        _;
    }

    function setDelegatedFrom(address _addr) onlyOwner public {
        delegatedFrom = _addr;
        emit DelegatedFromSet(_addr);
    }

    // each function delegateX is simply forwarded to function X
    function delegateTotalSupply() onlySender(delegatedFrom) public view returns (uint256) {
        return totalSupply();
    }

    function delegateBalanceOf(address _who) onlySender(delegatedFrom) public view returns (uint256) {
        return balanceOf(_who);
    }

    function delegateTransfer(address _to, uint256 _value, address _origSender) onlySender(delegatedFrom) public returns (bool) {
        transferAllArgs(_origSender, _to, _value);
        return true;
    }

    function delegateAllowance(address _owner, address _spender) onlySender(delegatedFrom) public view returns (uint256) {
        return allowance(_owner, _spender);
    }

    function delegateTransferFrom(address _from, address _to, uint256 _value, address _origSender) onlySender(delegatedFrom) public returns (bool) {
        transferFromAllArgs(_from, _to, _value, _origSender);
        return true;
    }

    function delegateApprove(address _spender, uint256 _value, address _origSender) onlySender(delegatedFrom) public returns (bool) {
        approveAllArgs(_spender, _value, _origSender);
        return true;
    }

    function delegateIncreaseApproval(address _spender, uint256 _addedValue, address _origSender) onlySender(delegatedFrom) public returns (bool) {
        increaseApprovalAllArgs(_spender, _addedValue, _origSender);
        return true;
    }

    function delegateDecreaseApproval(address _spender, uint256 _subtractedValue, address _origSender) onlySender(delegatedFrom) public returns (bool) {
        decreaseApprovalAllArgs(_spender, _subtractedValue, _origSender);
        return true;
    }

    function delegateBurn(address _origSender, uint256 _value) onlySender(delegatedFrom) public {
        burnAllArgs(_origSender, _value);
    }
}
