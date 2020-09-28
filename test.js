#!/usr/bin/env node

'use strict';

const fs = require('fs');
const Web3 = require('web3');
const web3 = new Web3('http://localhost:7545');

let accounts = {
  pnkDeployer: undefined,
  wethDeployer: undefined,
  balancerDeployer: undefined,
  bpoolDeployer: undefined,
  other: undefined,
  recovererDeployer: undefined,
  multisig: undefined,
};
let contracts = {
  pnk: undefined,
  weth: undefined,
  dsproxy: undefined,
  bactions: undefined,
  bfactory: undefined,
  bpool: undefined,
  newbpool: undefined,
  governor: undefined,
  // recoverer: undefined,
};

async function main() {
  let availableAccounts = await web3.eth.personal.getAccounts();

  accounts = {
    pnkDeployer: availableAccounts[0], // mainnet: 0x00B5ADe4ac1fE9cCc08Addc2C10070642335117F (here also used as PNK's controller instead of KlerosLiquid)
    wethDeployer: availableAccounts[1], // mainnet: 0x4F26FfBe5F04ED43630fdC30A87638d53D0b0876
    balancerDeployer: availableAccounts[2], // mainnet: 0x6E9eEF9b53a69F37EFcAB8489706E8B2bD82608b
    bpoolDeployer: availableAccounts[3], // mainnet: 0x5cfC6125672a7d1Af61dA570e09B9047d586bB7a
    other: availableAccounts[4],
    recovererDeployer: availableAccounts[5],
    governorDeployer: availableAccounts[6],
    multisig: availableAccounts[7],
  };
  let accountList = [];
  for (let k in accounts) {
    accountList.push({
      address: accounts[k],
      name: k,
    });
  }

  const initialWethBalance = '1128000000000000000000'; // 1128 WETH
  const initialPnkBalance = '9479701214992642668146019'; // 9,479,701.215 PNK

  const currentWethBalance = '1497869045760000000000';
  const currentPnkBalance = '7481018020279440000000000';

  console.log('>>> Contracts deployment <<<');
  await deploy(
    'pnk',
    'MiniMeToken.sol:MiniMeToken',
    [
      '0x0123456789abcDEF0123456789abCDef01234567', // _tokenFactory (unused)
      '0x0000000000000000000000000000000000000000', // _parentToken
      0, // _parentSnapshotBlock
      'Pinakion', // _tokenName
      18, // _decimalUnits
      'PNK', // _tokenSymbol
      true, // _transferEnabled
    ],
    {
      from: accounts.pnkDeployer,
    }
  );
  await deploy('weth', 'WETH9.sol:WETH9', [], {
    from: accounts.wethDeployer,
  });
  await deploy('bfactory', 'BFactory.sol:BFactory', [], {
    from: accounts.balancerDeployer,
  });
  await deploy('bactions', 'BActions.sol:BActions', [], {
    from: accounts.balancerDeployer,
  });
  await deploy(
    'dsproxy',
    'DSProxy.sol:DSProxy',
    ['0x0123456789abcDEF0123456789abCDef01234567'],
    {
      from: accounts.bpoolDeployer,
    }
  );
  await deployBPool(
    contracts.dsproxy,
    'bpool',
    initialWethBalance,
    initialPnkBalance
  );
  await deploy(
    'newdsproxy',
    'DSProxy.sol:DSProxy',
    ['0x0123456789abcDEF0123456789abCDef01234567'],
    {
      from: accounts.bpoolDeployer,
    }
  );
  await deployBPool(
    contracts.newdsproxy,
    'newbpool',
    (BigInt(currentWethBalance) / 100n).toString(),
    (BigInt(currentPnkBalance) / 100n).toString()
  );
  await deploy('governor', 'SimpleGovernor.sol:SimpleGovernor', [], {
    from: accounts.governorDeployer,
  });
  console.log('');

  for (let k in contracts) {
    accountList.push({
      address: contracts[k].options.address,
      name: k,
    });
  }

  console.log('>>> Setup <<<');
  await addLiquidity(accounts.other, '1578995576647687079');
  await lockLiquidity();
  await marketVariations(
    contracts.bpool,
    currentWethBalance,
    currentPnkBalance
  );
  console.log('Change controller to governor');
  await contracts.pnk.methods['changeController(address)'](
    contracts.governor.options.address
  ).send({
    from: accounts.pnkDeployer,
  });
  console.log('');

  await showBalances(
    [contracts.weth, contracts.pnk, contracts.bpool, contracts.newbpool],
    accountList
  );

  console.log('>>> Attack <<<');
  await deploy(
    'recoverer',
    'recoverer.sol:BalancerPoolRecoverer',
    [
      contracts.governor.options.address,
      contracts.pnk.options.address,
      contracts.weth.options.address,
      contracts.bpool.options.address,
      contracts.newbpool.options.address,
      accounts.pnkDeployer,
      accounts.multisig,
    ],
    {
      from: accounts.recovererDeployer,
    }
  );
  await contracts.recoverer.methods['registerLP(address)'](accounts.other).send(
    {
      from: accounts.recovererDeployer,
    }
  );
  await contracts.recoverer.methods['registerLP(address)'](
    accounts.bpoolDeployer
  ).send({
    from: accounts.recovererDeployer,
  });
  await attack();
  console.log('');

  accountList.push({
    address: contracts.recoverer.options.address,
    name: 'recoverer',
  });

  await showBalances(
    [contracts.weth, contracts.pnk, contracts.bpool, contracts.newbpool],
    accountList
  );

  console.log('>>> Recoverings <<<');
  await contracts.recoverer.methods['restoreLP(uint256)'](2).send({
    from: accounts.recovererDeployer,
  });

  await showBalances(
    [contracts.weth, contracts.pnk, contracts.bpool, contracts.newbpool],
    accountList
  );
}

/* DEPLOYMENT FUNCTIONS */

async function deploy(tag, name, args, options) {
  console.log('Deploying ' + tag + '...');
  let contract = getContract(name);
  contracts[tag] = await contract
    .deploy({
      arguments: args,
    })
    .send(options);
}

async function deployBPool(dsproxy, bpool, wethBalance, pnkBalance) {
  console.log('Deploying BPool...');

  // Mint tokens
  await mint(
    accounts.bpoolDeployer,
    wethBalance,
    pnkBalance,
    dsproxy.options.address
  );

  // Deploy BPool
  let tx = contracts.bactions.methods[
    'create(address,address[],uint256[],uint256[],uint256,bool)'
  ](
    contracts.bfactory.options.address, // factory
    [
      // tokens
      contracts.weth.options.address,
      contracts.pnk.options.address,
    ],
    [
      // balances
      wethBalance,
      pnkBalance,
    ],
    [
      // denorms
      '25000000000000000000',
      '25000000000000000000',
    ],
    '1000000000000000', // swapFee (0.1%)
    true // finalize
  ).encodeABI();

  await dsproxy.methods['execute(address,bytes)'](
    contracts.bactions.options.address,
    tx
  )
    .send({
      from: accounts.bpoolDeployer,
    })
    .once('receipt', (receipt) => {
      contracts[bpool] = getContract('BPool.sol:BPool');
      contracts[bpool].options.address = web3.utils.toChecksumAddress(
        receipt.events['1'].raw.topics[2].slice(-40)
      );
    });
}

/* SETUP FUNCTIONS */

async function addLiquidity(beneficiary, amount) {
  console.log("Adding other's liquidity...");

  const BONE = 1000000000000000000n;

  let bptTotalSupply = await contracts.bpool.methods['totalSupply()']().call();
  let ratio =
    (BigInt(amount) * BONE + BigInt(bptTotalSupply) / 2n) /
    BigInt(bptTotalSupply);

  let initialWethBalance = await contracts.bpool.methods['getBalance(address)'](
    contracts.weth.options.address
  ).call();
  let wethIn = (ratio * BigInt(initialWethBalance) + BONE / 2n) / BONE;
  let initialPnkBalance = await contracts.bpool.methods['getBalance(address)'](
    contracts.pnk.options.address
  ).call();
  let pnkIn = (ratio * BigInt(initialPnkBalance) + BONE / 2n) / BONE;

  // Join pool
  await mint(
    beneficiary,
    wethIn.toString(),
    pnkIn.toString(),
    contracts.bpool.options.address
  );

  await contracts.bpool.methods['joinPool(uint256,uint256[])'](amount, [
    wethIn,
    pnkIn,
  ]).send({
    from: beneficiary,
  });
}

async function lockLiquidity() {
  console.log('Locking liquidity...');
  await contracts.bpool.methods['transfer(address,uint256)'](
    contracts.bpool.options.address,
    '98000000000000000000'
  ).send({
    from: accounts.bpoolDeployer,
  });
}

async function marketVariations(bpool, targetWethBalance, targetPnkBalance) {
  console.log('Simulating market variations...');

  let currentWethBalance = await bpool.methods['getBalance(address)'](
    contracts.weth.options.address
  ).call();
  let currentPnkBalance = await bpool.methods['getBalance(address)'](
    contracts.pnk.options.address
  ).call();

  // Set WETH balance
  if (BigInt(targetWethBalance) < BigInt(currentWethBalance)) {
    let requiredPnk = await bpool.methods[
      'calcInGivenOut(uint256,uint256,uint256,uint256,uint256,uint256)'
    ](
      currentPnkBalance,
      1,
      currentWethBalance,
      1,
      (BigInt(currentWethBalance) - BigInt(targetWethBalance)).toString(),
      '1000000000000000'
    ).call();
    await mint(accounts.other, '0', requiredPnk, bpool.options.address);

    await bpool.methods[
      'swapExactAmountIn(address,uint256,address,uint256,uint256)'
    ](
      contracts.pnk.options.address,
      requiredPnk,
      contracts.weth.options.address,
      0,
      (2n ** 256n - 1n).toString()
    ).send({
      from: accounts.other,
    });
  } else {
    let requiredWeth = (
      BigInt(targetWethBalance) - BigInt(currentWethBalance)
    ).toString();
    await mint(accounts.other, requiredWeth, '0', bpool.options.address);

    await bpool.methods[
      'swapExactAmountIn(address,uint256,address,uint256,uint256)'
    ](
      contracts.weth.options.address,
      requiredWeth,
      contracts.pnk.options.address,
      0,
      (2n ** 256n - 1n).toString()
    ).send({
      from: accounts.other,
    });
  }

  // Set PNK balance
  currentPnkBalance = await bpool.methods['getBalance(address)'](
    contracts.pnk.options.address
  ).call();
  if (BigInt(targetPnkBalance) > BigInt(currentPnkBalance)) {
    await contracts.pnk.methods['generateTokens(address,uint256)'](
      bpool.options.address,
      (BigInt(targetPnkBalance) - BigInt(currentPnkBalance)).toString()
    ).send({
      from: accounts.pnkDeployer,
    });
  } else {
    await contracts.pnk.methods['transferFrom(address,address,uint256)'](
      bpool.options.address,
      accounts.other,
      (BigInt(currentPnkBalance) - BigInt(targetPnkBalance)).toString()
    ).send({
      from: accounts.pnkDeployer,
    });
  }
  await bpool.methods['gulp(address)'](contracts.pnk.options.address).send({
    from: accounts.other,
  });
}

/* ATTACK FUNCTION*/

async function attack() {
  console.log('  Building transaction list...');
  let txList = [];

  console.log("    Transfer PNK's controller rights");
  txList.push(
    contracts.pnk.methods['changeController(address)'](
      contracts.recoverer.options.address
    )
      .encodeABI()
      .slice(2)
  );

  console.log('    Trigger attack');
  txList.push(contracts.recoverer.methods['attack()']().encodeABI().slice(2));

  console.log('  Submitting transaction list (can fail half the time)...');
  await contracts.governor.methods[
    'submitList(address[],uint256[],bytes,uint256[],string)'
  ](
    [contracts.pnk.options.address, contracts.recoverer.options.address],
    [0, 0],
    '0x' + txList.join(''),
    [txList[0].length / 2, txList[1].length / 2],
    ''
  ).send({
    from: accounts.governorDeployer,
  });

  console.log('  Triggering transaction list...');
  await contracts.governor.methods[
    'executeTransactionList(uint256,uint256,uint256)'
  ](0, 0, 2).send({
    from: accounts.governorDeployer,
  });
}

/* UTILITY */

async function mint(beneficiary, weth, pnk, approveFor) {
  console.log('  Minting tokens...');
  await contracts.weth.methods['deposit()']().send({
    from: beneficiary,
    value: weth,
  });
  await contracts.pnk.methods['generateTokens(address,uint256)'](
    beneficiary,
    pnk
  ).send({
    from: accounts.pnkDeployer,
  });

  if (approveFor) {
    console.log('  Approving transfers...');
    await contracts.weth.methods['approve(address,uint256)'](
      approveFor,
      weth
    ).send({
      from: beneficiary,
    });
    await contracts.pnk.methods['approve(address,uint256)'](
      approveFor,
      pnk
    ).send({
      from: beneficiary,
    });
  }
}

async function showBalances(tokenList, accountList) {
  let balance;
  for (let account of accountList) {
    process.stdout.write(account.name.padStart(20, ' '));
    for (let token of tokenList) {
      process.stdout.write(' ');
      balance = await token.methods['balanceOf(address)'](
        account.address
      ).call();
      balance = (Number(balance) / 10 ** 18).toString();
      process.stdout.write(balance.padStart(30, ' '));
    }
    process.stdout.write('\n');
  }
  process.stdout.write('\n');
}

function getContract(name) {
  if (getContract.contracts === undefined) {
    // Compile with
    // solc *.sol --combined-json abi,asm,ast,bin,bin-runtime,compact-format,devdoc,hashes,interface,metadata,opcodes,srcmap,srcmap-runtime,userdoc > contracts.json
    let source = fs.readFileSync('contracts.json');
    getContract.contracts = JSON.parse(source)['contracts'];
  }

  let jsonInterface = JSON.parse(getContract.contracts[name].abi);
  let data = '0x' + getContract.contracts[name].bin;

  // Create contract proxy class
  let contract = new web3.eth.Contract(jsonInterface, undefined, {
    gasLimit: '10000000',
  });
  contract.options.data = data;
  return contract;
}

main();
