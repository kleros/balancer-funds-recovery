pragma solidity ^0.6.5;

interface ITokenController {
    function proxyPayment(address _owner) external payable returns (bool);
    function onTransfer(address _from, address _to, uint256 _amount) external returns (bool);
    function onApprove(address _owner, address _spender, uint256 _amount) external returns (bool);
}
