pragma solidity ^0.6.5;

import "./IERC20.sol";

interface IBPool is IERC20 {
    function getBalance(address token) external view returns (uint256);
    function getSwapFee() external view returns (uint256);
    function gulp(address token) external;
    function swapExactAmountIn(
        address tokenIn,
        uint256 tokenAmountIn,
        address tokenOut,
        uint256 minAmountOut,
        uint256 maxPrice
    ) external returns (uint256 tokenAmountOut, uint256 spotPriceAfter);
    function joinPool(uint256 poolAmountOut, uint256[] calldata maxAmountsIn) external;
}
