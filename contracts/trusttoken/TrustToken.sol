// SPDX-License-Identifier: MIT
pragma solidity 0.6.10;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {TimeLockedToken} from "./TimeLockedToken.sol";

/**
 * @title TrustToken
 * @dev The TrustToken contract is a claimable contract where the
 * owner can only mint or transfer ownership. TrustTokens use 8 decimals
 * in order to prevent rewards from getting stuck in the remainder on division.
 * Tolerates dilution to slash stake and accept rewards.
 */
contract TrustToken is TimeLockedToken {
    using SafeMath for uint256;

    uint256 constant MAX_SUPPLY = 145000000000000000;

    function _transfer(
        address _from,
        address _to,
        uint256 _amount
    ) internal override {
        // check if recipient is not the TRU contract itself
        require(_to != address(this), "TrustToken: Can't transfer to the TRU contract itself");
        super._transfer(_from, _to, _amount);
    }

    /**
     * @dev initialize trusttoken and give ownership to sender
     * This is necessary to set ownership for proxy
     */
    function initialize() public {
        require(!initalized, "already initialized");
        owner_ = msg.sender;
        initalized = true;
    }

    /**
     * @dev mint TRU
     * Can never mint more than MAX_SUPPLY = 1.45 billion
     */
    function mint(address _to, uint256 _amount) external onlyOwner {
        if (totalSupply.add(_amount) <= MAX_SUPPLY) {
            _mint(_to, _amount);
        } else {
            revert("Max supply exceeded");
        }
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function rounding() public pure returns (uint8) {
        return 8;
    }

    function name() public pure override returns (string memory) {
        return "TrueFi";
    }

    function symbol() public pure override returns (string memory) {
        return "TRU";
    }
}
