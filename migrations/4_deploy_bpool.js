const settings = {
  wethBalance: "1128000000000000000000", // 1128 WETH
  pnkBalance: "9479701214992642668146019" // 9,479,701.215 PNK
}

const proxySettings = {
  cacheAddr: "0x0123456789abcDEF0123456789abCDef01234567" // unused
}

const poolSettings = {
  denorms: ["25000000000000000000", "25000000000000000000"],
  swapFee: "1000000000000000",
  finalize: true
}

const WethToken = artifacts.require("xWETH9")
const PnkToken = artifacts.require("xMiniMeToken")

const BFactory = artifacts.require("xBFactory")
const BActions = artifacts.require("xBActions")
const DSProxy = artifacts.require("xDSProxy")
const BPool = artifacts.require("xBPool")

module.exports = function (deployer, network, accounts) {
  const addressOf = require("./utils/addressOf")(accounts)
  const logTx = require("./utils/logTx")([WethToken, PnkToken, DSProxy]).bind({ web3: web3 })

  let wethToken
  let pnkToken
  let dsproxy

  const bactionsContract = new web3.eth.Contract(BActions.toJSON().abi)
  let tx

  deployer
    .then(() => deployer.deploy(BFactory))
    .then(() => deployer.deploy(BActions))
    .then(() => deployer.deploy(DSProxy, proxySettings.cacheAddr, { from: addressOf.deployer }))
    .then(async () => {
      wethToken = await WethToken.deployed()
      pnkToken = await PnkToken.deployed()
      dsproxy = await DSProxy.deployed()
    })
    .then(() => {
      tx = bactionsContract.methods["create(address,address[],uint256[],uint256[],uint256,bool)"](
        BFactory.address,
        [WethToken.address, PnkToken.address],
        [settings.wethBalance, settings.pnkBalance],
        poolSettings.denorms,
        poolSettings.swapFee,
        poolSettings.finalize
      ).encodeABI()
    })
    .then(() => wethToken.deposit({ from: addressOf.deployer, value: settings.wethBalance }))
    .then(logTx)
    .then(() =>
      wethToken.approve(DSProxy.address, settings.wethBalance, { from: addressOf.deployer })
    )
    .then(logTx)
    .then(() => pnkToken.generateTokens(addressOf.deployer, settings.pnkBalance))
    .then(logTx)
    .then(() =>
      pnkToken.approve(DSProxy.address, settings.pnkBalance, { from: addressOf.deployer })
    )
    .then(logTx)
    .then(async () => {
      // truffle preDeploy
      const currentBlock = await BPool.interfaceAdapter.getBlock("latest")
      const eventArgs = {
        state: {
          contractName: BPool.contractName
        },
        contract: BPool,
        deployed: BPool.isDeployed(),
        blockLimit: currentBlock.gasLimit,
        gas: BPool.defaults().gas,
        gasPrice: BPool.defaults().gasPrice,
        from: addressOf.deployer
      }
      try {
        eventArgs.estimate = await dsproxy.methods[
          "execute(address,bytes)"
        ].estimateGas.apply(DSProxy, [BActions.address, tx, { from: addressOf.deployer }])
      } catch (err) {
        eventArgs.estimateError = err
      }
      await deployer.emitter.emit("preDeploy", eventArgs)
    })
    .then(() =>
      dsproxy.methods["execute(address,bytes)"](BActions.address, tx, { from: addressOf.deployer })
    )
    .then(async (tx) => {
      // truffle transactionHash
      const eventArgs = {
        contractName: BPool.contractName,
        transactionHash: tx.tx
      }
      await deployer.emitter.emit("transactionHash", eventArgs)
      return tx
    })
    .then(async (tx) => {
      // truffle postDeploy (record deployed address)
      const data = {
        contract: BPool,
        instance: undefined,
        deployed: true,
        receipt: tx.receipt
      }
      data.receipt.contractAddress = web3.utils.toChecksumAddress(
        tx.receipt.rawLogs[1].topics[2].slice(-40)
      )
      data.instance = BPool.at(data.receipt.contractAddress)
      await deployer.emitter.emit("postDeploy", data)

      BPool.address = data.receipt.contractAddress
      BPool.transactionHash = tx.tx

      return tx
    })
    .then(logTx)
}
