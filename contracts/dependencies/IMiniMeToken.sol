pragma solidity ^0.6.5;

import "./IERC20.sol";

interface IMiniMeToken is IERC20 {
    function changeController(address _governor) external;
    function controller() external view returns (address); // Getter
}
