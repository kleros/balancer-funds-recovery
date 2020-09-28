pragma solidity ^0.6.5;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

abstract contract MiniMeToken is IERC20 {
    function changeController(address _governor) virtual external;
}

abstract contract WETH9 is IERC20 {}

abstract contract KlerosLiquid {}

abstract contract BPool is IERC20 {
    function getBalance(address token) virtual external view returns (uint256);
    function getSwapFee() virtual external view returns (uint256);
    function gulp(address token) virtual external;
    function swapExactAmountIn(
        address tokenIn,
        uint256 tokenAmountIn,
        address tokenOut,
        uint256 minAmountOut,
        uint256 maxPrice
    ) virtual external returns (uint256 tokenAmountOut, uint256 spotPriceAfter);
    function joinPool(uint256 poolAmountOut, uint256[] calldata maxAmountsIn) virtual external;
}

abstract contract KlerosGovernor {}

/** @title BalancerPoolRecoverer
  * @dev The contract used to recover funds locked in a Balancer Pool
  */
contract BalancerPoolRecoverer {
    /* *** Variables *** */

    // Constants
    uint256 constant gasPerIteration = 92294; // Gas consumed by one iteration of the main loop
    uint256 constant BONE = 10 ** 18; // Balancer's one (1) in fixed point arithmetic

    // Contracts and addresses to act on (immutable)
    KlerosGovernor immutable governor;
    MiniMeToken immutable pnkToken;
    WETH9 immutable wethToken;
    BPool immutable bpool;
    BPool immutable newBpool;
    KlerosLiquid immutable controller;
    address immutable beneficiary;

    // State variable
    bool attackDone;
    uint256 public balanceBPT;
    uint256 newBalanceBPT;
    mapping(address => uint256) public lpBalance; // Recorded balance of a liquidity provider
    address[] lpList;


    /* *** Modifier *** */

    modifier onlyGovernor() {
        require(msg.sender == address(governor));
        _;
    }

    /** @dev Constructor
     *  @param _governor The governor of the contract. In this case it is the KlerosGovernor contract, at 0xNotYetDeployed
     *  @param _pnkToken The PNK token, at 0x93ED3FBe21207Ec2E8f2d3c3de6e058Cb73Bc04d
     *  @param _wethToken The WETH token, at 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
     *  @param _bpool The BPool to recover the liquidity from, at 0xC81d50c17754B379F1088574CF723Be4fb00307D
     *  @param _newBpool The BPool to send the recovered liquidity to, at 0xNotYetDeployed
     *  @param _controller The controller of the PNK token. In this case it is the KlerosLiquid contract, at 0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069
     *  @param _beneficiary The address to send the equivalent of locked liquidity to, at 0x67a57535b11445506a9e340662CD0c9755E5b1b4
     */
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

    /** @dev Register an existing liquidity provider of the old pool
     *  @param lp The liquidity provider to register
     *  Note that the old pool is blacklisted to prevent locking the same liquidity in the new pool
     */
    function registerLP(address lp) external {
        require(!attackDone);
        require(lp != address(bpool)); // Blacklist

        if (bpool.balanceOf(lp) != 0 && lpBalance[lp] == 0) {
            lpBalance[lp] = 1; // Actual balance will be recorded in the recovery transaction (in the attack function)
            lpList.push(lp);
        }
    }

    /** @dev Send equivalent liquidity tokens of the new pool to the registered liquidity providers of the old pool
     *  @param iterations Number of liquidity providers to process
     *  Note that after all liquidity providers are processed, the remaining funds are sent to this contract's beneficiary.
     *  As the locked liquidity is blacklisted, it will necessarily be sent to the beneficiary.
     */
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

        // After every LP has been reimbursed, send remaining funds to beneficiary
        if (lpList.length == 0) {
            newBpool.transfer(beneficiary, newBpool.balanceOf(address(this)));
            wethToken.transfer(beneficiary, wethToken.balanceOf(address(this)));
            pnkToken.transfer(beneficiary, pnkToken.balanceOf(address(this)));
        }
    }

    /** @dev Restore the PNK token's controller
      * In case the attack cannot be executed
      */
    function restoreController() public onlyGovernor {
        pnkToken.changeController(address(controller));
    }

    /** @dev Recover the locked funds
      * This function ensures everything happens in the same transaction. It
      * - records liquidity provider's share in the old pool,
      * - recovers as much funds as possible from the old pool,
      * - sends them to the new pool, and
      * - restores PNK's controller rights to its original controller
      * Note that this function requires a high gas limit and consumes more gas the lower the gas fee
      */
    function attack() external onlyGovernor {
        attackDone = true;

        /* QUERY POOL STATE */
        uint256 poolBalanceWETH = bpool.getBalance(address(wethToken));
        uint256 poolBalancePNK = pnkToken.balanceOf(address(bpool));
        uint256 balanceWETH = poolBalanceWETH;
        uint256 balancePNK = poolBalancePNK;
        uint256 swapFee = bpool.getSwapFee();

        /* RECORD CURRENT HOLDERS' LIQUIDITY SHARE */
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

        // Repeat as long as recovering the next WETH does not cost more in gas than the WETH itself
        while (nextAmountOut > gasPerIteration * tx.gasprice) {
            poolBalanceWETH -= nextAmountOut;
            poolBalancePNK += nextAmountIn;

            bpool.swapExactAmountIn(
                address(pnkToken), // tokenIn
                nextAmountIn, // tokenAmountIn
                address(wethToken), // tokenOut
                0, // minAmountOut
                uint256(-1) // maxPrice
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

    // Since the attack contract is PNK's controller, it has to allow transfers and approvals
    function onTransfer(address _from, address _to, uint256 _amount) public returns (bool) {
        return true;
    }
    function onApprove(address _owner, address _spender, uint256 _amount) public returns (bool) {
        return true;
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
