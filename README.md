# Context

## Affected contracts and addresses

|                                                    Address                                                     | Description                           |
| -------------------------------------------------------------------------------------------------------------- |:------------------------------------- |
| [Lost liquidity](https://etherscan.io/tx/0xbb26dbc1a8da0a136d95276bf6193244ca07075db8fbb8a9d56cfdd90571af90)   | Transaction that "burned" 98 BPT      |
| [BPT](https://etherscan.io/token/0xc81d50c17754b379f1088574cf723be4fb00307d)                                   | Token of "Balancer: ETH/PNK 50/50 #2" |
| [PNK](https://etherscan.io/token/0x93ed3fbe21207ec2e8f2d3c3de6e058cb73bc04d)                                   | Token of "Kleros"                     |
| [KlerosLiquid](https://etherscan.io/address/0x988b3a538b618c7a603e1c11ab82cd16dbe28069)                        | Contract set as PNK's controller      |

## Background

On August 3rd 2020, balancer liquidity tokens ([BPT](https://etherscan.io/token/0xc81d50c17754b379f1088574cf723be4fb00307d)) [have been sent](https://etherscan.io/tx/0xbb26dbc1a8da0a136d95276bf6193244ca07075db8fbb8a9d56cfdd90571af90) by mistake to a wrong address.
These tokens are effectively burned. As they are (in theory) required to pull the liquidity back from the pool, the invested WETH and PNK are (supposedly) locked.

However, as Kleros controls the balances of one of the tokens ([PNK](https://etherscan.io/token/0x93ed3fbe21207ec2e8f2d3c3de6e058cb73bc04d)), we can recover the funds.

# The attack

The idea is to leverage the control over PNK's balances to trick the pool into overestimating the value of PNK over WETH.

We need to first pull some PNK from the pool, then swap some PNK for the WETH we want to recover. Note that:
- we can use the PNK pulled to make the swap
- everything has to happen in the same transaction to prevent front-running

Only the controller of [PNK](https://etherscan.io/token/0x93ed3fbe21207ec2e8f2d3c3de6e058cb73bc04d) (i.e. [KlerosLiquid](https://etherscan.io/address/0x988b3a538b618c7a603e1c11ab82cd16dbe28069)) can transfer tokens at will. However, it can only execute a single arbitrary transaction at a time. So we need to temporarily replace PNK's controller.

## Steps

1. Deploy a new `BPool`
1. Deploy `BalancerPoolRecoverer`
1. Register current pool's LP (BPT holders)
1. Transfer PNK's controller rights
1. Execute the attack
1. Send holders their new BPT

The governor enforces a strict order of transactions. This can be worked around by padding some transactions calldata if necessary.

# Calculations

## Migration to a new Balancer Pool

We need to join the new `BPool` using the `joinPool()` method, but this method uses its own fixed point approximations to determine how many tokens to pull. We need to do the reverse calculation.

Here's how `BPool` fixed point arithmetic calculates the amount to pull for token <img src="https://latex.codecogs.com/svg.latex?t"/>, where:
- <img src="https://latex.codecogs.com/svg.latex?A_t"/> is the amount of token <img src="https://latex.codecogs.com/svg.latex?t"/> to pull (dependent variable `tokenAmountIn`)
- <img src="https://latex.codecogs.com/svg.latex?{A_t}'"/> is our balance of token <img src="https://latex.codecogs.com/svg.latex?t"/>.
- <img src="https://latex.codecogs.com/svg.latex?B_t"/> is the pool's current balance of token <img src="https://latex.codecogs.com/svg.latex?t"/>
- <img src="https://latex.codecogs.com/svg.latex?L_o"/> is the amount of liquidity tokens we ask for (independent variable `poolAmountOut`)
- <img src="https://latex.codecogs.com/svg.latex?L"/> is the total supply of liquidity tokens (constant `totalSupply()`)

<img src="https://latex.codecogs.com/svg.latex?{A_t}'\geq{A_t}=\left\lfloor\frac{\left\lfloor\frac{10^{18}L_o+\left\lfloor\frac{L}{2}\right\rfloor}{L}\right\rfloor{B_t}+5\cdot10^{17}}{10^{18}}\right\rfloor\quad\left(\approx\frac{L_o}{L}B_t\right)"/>

Note that we must choose <img src="https://latex.codecogs.com/svg.latex?L_o"/> such that this inequality holds true, thus we can simply remove the <img src="https://latex.codecogs.com/svg.latex?\lfloor\cdot\rfloor"/>. As <img src="https://latex.codecogs.com/svg.latex?L_o"/> is our variable, this ensures it stays within its domain of validity.

<img src="https://latex.codecogs.com/svg.latex?\begin{align*}&{A_t}'&\geq&\frac{\left\lfloor\frac{10^{18}L_o+\left\lfloor\frac{L}{2}\right\rfloor}{L}\right\rfloor{B_t}+5\cdot10^{17}}{10^{18}}\\\iff&\frac{10^{18}{A_t}'-5\cdot10^{17}}{B_t}&\geq&\left\lfloor\frac{10^{18}L_o+\left\lfloor\frac{L}{2}\right\rfloor}{L}\right\rfloor\end{align*}"/>

Once again we can simply remove the <img src="https://latex.codecogs.com/svg.latex?\lfloor\cdot\rfloor"/>.

<img src="https://latex.codecogs.com/svg.latex?\begin{align*}&\frac{10^{18}{A_t}'-5\cdot10^{17}}{B_t}&\geq&\frac{10^{18}L_o+\left\lfloor\frac{L}{2}\right\rfloor}{L}\\\iff&\frac{\frac{10^{18}{A_t}'-5\cdot10^{17}}{B_t}L-\left\lfloor\frac{L}{2}\right\rfloor}{10^{18}}&\geq&L_o\end{align*}"/>

# Effects

The original pool will be almost emptied. Thus the associated liquidity tokens (BPT) will lose almost all of their value.
A new identical pool will be created and the original pool's liquidity providers will be given equivalent liquidity tokens in the new pool.

# Test

You need `nodejs` and the `web3` library.
The test script assumes you have a HTTP provider running at `http://localhost:7545` (typically ganache) with a list of funded account.
