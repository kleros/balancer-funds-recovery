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

1. Deploy `BalancerPoolRecoverer`
1. Transfer PNK's controller rights
1. Execute the attack

# Computations

We will use the pool's `swapExactAmountIn` function. Here is its formula, where:
- <img src="https://latex.codecogs.com/svg.latex?A_{i}"/> is the amount entering the pool (in PNK)
- <img src="https://latex.codecogs.com/svg.latex?A_{o}"/> is the amount leaving the pool (in WETH)
- <img src="https://latex.codecogs.com/svg.latex?B_{i}"/> is the pool's balance of the token entering the pool (PNK)
- <img src="https://latex.codecogs.com/svg.latex?B_{o}"/> is the pool's balance of the token leaving the pool (WETH)
- <img src="https://latex.codecogs.com/svg.latex?f"/> is the swap fee

<img src="https://latex.codecogs.com/svg.latex?A_{o}=B_{o}\left(1-\left(\frac{B_{i}}{B_{i}+A_{i}\left(1-f\right)}\right)\right)"/>

Let <img src="https://latex.codecogs.com/svg.latex?\$_{i}"/> (resp. <img src="https://latex.codecogs.com/svg.latex?\$_{o}"/>) be the amount of PNK (resp. WETH) to recover.

We thus have <img src="https://latex.codecogs.com/svg.latex?{B'}_{i}=B_{i}-\left(A_{i}+\$_{i}\right)"/> the adjusted balance of PNK after we pull funds from the pool.
Also we have <img src="https://latex.codecogs.com/svg.latex?\$_{o}=A_{o}"/>.

So the equation can be rewritten as

<img src="https://latex.codecogs.com/svg.latex?\$_{o}=B_{o}\left(1-\left(\frac{B_{i}-\left(\$_{i}+A_{i}\right)}{B_{i}-\left(\$_{i}+A_{i}\right)+A_{i}\left(1-f\right)}\right)\right)"/>
<img src="https://latex.codecogs.com/svg.latex?\$_{o}=B_{o}\left(1-\left(\frac{B_{i}-\left(\$_{i}+A_{i}\right)}{B_{i}-\left(\$_{i}+fA_{i}\right)}\right)\right)"/>
<img src="https://latex.codecogs.com/svg.latex?1-\frac{\$_{o}}{B_{o}}=\frac{B_{i}-\left(\$_{i}+A_{i}\right)}{B_{i}-\left(\$_{i}+fA_{i}\right)}"/>
<img src="https://latex.codecogs.com/svg.latex?A_{i}=\frac{\$_{o}\left(B_{i}-\$_{i}\right)}{B_{o}-f\left(B_{o}-\$_{o}\right)}"/>

# Effects

As liquidity will be removed without burning the associated liquidity token (BPT), each BPT will be worth less (-96% at the time of writing), that's why we need to tell this pool's BPT holders to withdraw their funds before launching the attack.
