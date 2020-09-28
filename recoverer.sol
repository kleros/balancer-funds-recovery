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
    address public controller; // Getter
}

abstract contract TokenController {
    function proxyPayment(address _owner) virtual public payable returns (bool);
    function onTransfer(address _from, address _to, uint256 _amount) virtual public returns (bool);
    function onApprove(address _owner, address _spender, uint256 _amount) virtual public returns (bool);
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
contract BalancerPoolRecoverer is TokenController {
    /* *** Variables *** */

    // Constants
    uint256 constant gasPerIteration = 92294; // Gas consumed by one iteration of the main loop
    uint256 constant BONE = 10 ** 18; // Balancer's one (1) in fixed point arithmetic

    // Contracts and addresses to act on (immutable)
    KlerosGovernor immutable public governor;
    MiniMeToken immutable public pnkToken;
    WETH9 immutable public wethToken;
    BPool immutable public bpool;
    KlerosLiquid immutable public controller;
    address immutable public beneficiary;

    // Storage
    bool attackOngoing; // Control TokenController functionality (block transfers by default)
    uint256 initiateRestoreControllerTimestamp;


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
     *  @param _controller The controller of the PNK token. In this case it is the KlerosLiquid contract, at 0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069
     *  @param _beneficiary The address to send the equivalent of locked liquidity to, at 0x67a57535b11445506a9e340662CD0c9755E5b1b4
     */
    constructor(
        KlerosGovernor _governor,
        MiniMeToken _pnkToken,
        WETH9 _wethToken,
        BPool _bpool,
        KlerosLiquid _controller,
        address _beneficiary
    ) public {
        governor = _governor;
        pnkToken = _pnkToken;
        wethToken = _wethToken;
        bpool = _bpool;
        controller = _controller;
        beneficiary = _beneficiary;
    }

    /** @dev Ask for PNK token's controller to be restored
     *  Safeguard if the attack does not work.
     *  Note that this gives one hour for the attack to be executed
     */
    function initiateRestoreController() external {
        require(initiateRestoreControllerTimestamp == 0);
        require(pnkToken.controller() == address(this));
        initiateRestoreControllerTimestamp = block.timestamp;
    }

    /** @dev Restore the PNK token's controller
     *  In case the attack cannot be executed
     *  Can be called by the governor, or by anyone one hour after initiateRestoreController
     */
    function restoreController() external {
        require(msg.sender == address(governor) || initiateRestoreControllerTimestamp + 1 hours < block.timestamp);
        pnkToken.changeController(address(controller));
    }

    /** @dev Recover the locked funds
     *  This function ensures everything happens in the same transaction.
     *  Note that this function requires a high gas limit and consumes more gas the lower the gas fee
     */
    function attack() external onlyGovernor {
        attackOngoing = true;

        /* QUERY POOL STATE */
        uint256 poolBalanceWETH = bpool.getBalance(address(wethToken));
        uint256 poolBalancePNK = pnkToken.balanceOf(address(bpool));
        uint256 balanceWETH = poolBalanceWETH;
        uint256 balancePNK = poolBalancePNK;
        uint256 swapFee = bpool.getSwapFee();

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
        pnkToken.transferFrom(address(bpool), address(this), poolBalancePNK); // Need to be the controller

        /* SEND FUNDS TO BENEFICIARY */
        wethToken.transfer(beneficiary, balanceWETH);
        pnkToken.transfer(beneficiary, balancePNK);

        /* RESTORE CONTROLLER */
        pnkToken.changeController(address(controller));
    }

    // Since the attack contract is PNK's controller, it has to allow transfers and approvals during the attack only
    function proxyPayment(address _owner) override public payable returns (bool) {
        return false;
    }
    function onTransfer(address _from, address _to, uint256 _amount) override public returns (bool) {
        return attackOngoing;
    }
    function onApprove(address _owner, address _spender, uint256 _amount) override public returns (bool) {
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
