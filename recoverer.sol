pragma solidity 0.5.12;

interface MiniMeToken {
    function balanceOf(address _owner) external view returns (uint256 balance);

    function transferFrom(
        address _from,
        address _to,
        uint256 _amount
    ) external returns (bool success);

    function transfer(address _to, uint256 _amount) external returns (bool success);

    function changeController(address _governor) external;
}

interface WETH9 {
    function transfer(address dst, uint256 wad) external returns (bool);
}

interface KlerosLiquid {}

interface BPool {
    function totalSupply() external view returns (uint256);
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
}

/*
    Recover funds related to the BPT liquidity locked at 0xd14b5739f5ff646e8f9b6ccf661257cbdf6dd0c4ece8b371eabe397b9d05da6e

    WARNING: The liquidity in this pool will lose about 96% (pool's BPT balance / BPT total supply) of its value at the time of writing

    Only the controller of PNK (MiniMeToken) can transfer tokens at will.
        WETH is at 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
        PNK  is at 0x93ED3FBe21207Ec2E8f2d3c3de6e058Cb73Bc04d
        Its controller is KlerosLiquid at 0x988b3a538b618c7a603e1c11ab82cd16dbe28069
        The controller's governor is 0x334f12afb7d8740868be04719639616533075234 (EOA)

    Everything must happen in the same transaction to prevent front-running

    KlerosLiquid can only execute one arbitrary internal transaction (as the msg.sender)
        at a time (call rather than delegatecall)
    This implies that either:
     - KlerosLiquid's governor needs to be changed (temporarily) to the attacking contract, or
     - PNK's controller needs to be changed (temporarily) to the attacking contract
    Here we went for the second (simplest) solution

    Attack steps:
        1. Deploy BalancerPoolRecoverer
        2. Transfer PNK's controller rights to the deployed BalancerPoolRecoverer
        3. Execute BalancerPoolRecoverer.attack()
*/

contract BalancerPoolRecoverer {
    address owner;

    MiniMeToken pnkToken;
    WETH9 wethToken;
    BPool bpool;
    KlerosLiquid controller;

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    constructor(
        MiniMeToken _pnkToken,
        WETH9 _wethToken,
        BPool _bpool,
        KlerosLiquid _controller
    ) public {
        owner = msg.sender;
        pnkToken = _pnkToken;
        wethToken = _wethToken;
        bpool = _bpool;
        controller = _controller;
    }

    // EMERGENCY
    function arbitraryDelegatecall(address payable _target, bytes calldata _data) external payable onlyOwner {
        (bool success,) = _target.delegatecall(_data);
        require(success);
    }
    function arbitraryCall(address payable _target, uint256 _value, bytes calldata _data) external payable onlyOwner {
        (bool success,) = _target.call.value(_value)(_data);
        require(success);
    }

    function restoreController() public onlyOwner {
        pnkToken.changeController(address(controller));
    }

    function attack() external onlyOwner {
        /* QUERY POOL STATE */
        uint256 totalSupply = bpool.totalSupply();
        uint256 balanceBPT  = bpool.getBalance(address(bpool));
        uint256 balancePNK  = bpool.getBalance(address(pnkToken));
        uint256 balanceWETH = bpool.getBalance(address(wethToken));
        uint256 swapFee     = bpool.getSwapFee();
        uint256 recoverWETH = balanceWETH * balanceBPT / totalSupply;
        uint256 recoverPNK  = balancePNK * balanceBPT / totalSupply;

        /* COMPUTATIONS */
        uint256 num   = (balancePNK - recoverPNK) * recoverWETH;
        uint256 denum = balanceWETH - swapFee * (balanceWETH - recoverWETH) / BONE;
        uint256 tokenAmountIn = num / denum;

        /* PULL PNK */
        pnkToken.transferFrom(address(bpool), address(this), recoverPNK + tokenAmountIn); // Need to be the controller
        bpool.gulp(address(pnkToken));

        /* PULL WETH (A.K.A ARBITRATION) */
        bpool.swapExactAmountIn(
            address(pnkToken),  // tokenIn
            tokenAmountIn,      // tokenAmountIn
            address(wethToken), // tokenOut
            0,                  // minAmountOut
            uint256(-1)         // maxPrice
        );

        /* SEND RECOVERED TOKENS */
        pnkToken.transfer(owner, recoverPNK);
        wethToken.transfer(owner, recoverWETH);

        /* RESTORE CONTROLLER */
        restoreController();
    }
}
