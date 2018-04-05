pragma solidity ^0.4.18;

import "../modularERC20/ModularPausableToken.sol";


// mock class using PausableToken
contract PausableTokenMock is ModularPausableToken {

  function PausableTokenMock(address initialAccount, uint initialBalance) public {
    balances = new BalanceSheet();
    allowances = new AllowanceSheet();
    balances.setBalance(initialAccount, initialBalance);
  }

}
