// Import this way:
// require('./utils/logTx')([ Contract1, Contract2 ]).bind({web3: web3})

module.exports = (contractList) => {
  let known_contracts = {}
  contractList.forEach((contract) => (known_contracts[contract.contract_name] = contract))

  // Transparent function to log a transaction
  return async function logTx(tx) {
    const web3 = this.web3

    // Util functions
    const decAndHex = (num) => `${Number(num).toString(10)} (0x${Number(num).toString(16)})`
    const underline = (msg) =>
      typeof msg === "number" ? `${"-".repeat(msg)}` : `\n${msg}\n${"-".repeat(msg.length)}`

    // Process tx data
    const transaction = await web3.eth.getTransaction(tx.tx)
    // const block = await web3.eth.getBlock(tx.receipt.blockNumber)
    // const gasPrice = (BigInt(transaction.gasPrice) / 10n ** 9n).toString()
    // const deployerBalance = await web3.eth.getBalance(tx.receipt.from)
    // const totalCost = (
    //   BigInt(tx.receipt.gasUsed) * BigInt(transaction.gasPrice) +
    //   BigInt(transaction.value)
    // ).toString()

    // Process call data
    let contractName = Object.keys(known_contracts).find((contract) => {
      return (
        known_contracts[contract].isDeployed() &&
        known_contracts[contract].address.toLowerCase() === tx.receipt.to
      )
    })
    let calledMethod
    let parameters = {}
    if (contractName) {
      const contract = known_contracts[contractName]

      const contractAbi = contract.toJSON().abi
      const methodSignature = transaction.input.substr(0, 10)
      for (let method of contractAbi) {
        if (method.signature === methodSignature) {
          calledMethod =
            method.name +
            "(" +
            method.inputs.map((input) => input.type + " " + input.name).join(", ") +
            ")"
          parameters =
            method.inputs.length !== 0
              ? web3.eth.abi.decodeParameters(method.inputs, `0x${transaction.input.substr(10)}`)
              : {}
        }
      }
    } else {
      contractName = "<unknown contract>"
    }
    calledMethod = calledMethod || "<unknown method>"

    // Build output string
    let output = ""
    output += underline(`Executed ${calledMethod.split("(")[0]} on '${contractName}'`)
    output += `\n> ${"method:".padEnd(20)} ${calledMethod}`
    for (let arg of Object.keys(parameters)) {
      if (isNaN(arg) && arg !== "__length__") {
        output += `\n  ${`> ${arg}:`.padEnd(20)} ${parameters[arg]}`
      }
    }
    output += `\n> ${"transaction hash:".padEnd(20)} ${tx.tx}`
    output += `\n> ${"block number:".padEnd(20)} ${tx.receipt.blockNumber}`
    // output += `\n> ${'block timestamp:'.padEnd(20)} ${block.timestamp}`;
    output += `\n> ${"account:".padEnd(20)} ${web3.utils.toChecksumAddress(tx.receipt.from)}`
    // output += `\n> ${'balance:'.padEnd(20)} ${web3.utils.fromWei(deployerBalance)}`;
    output += `\n> ${"gas used:".padEnd(20)} ${decAndHex(tx.receipt.gasUsed)}`
    // output += `\n> ${'gas price:'.padEnd(20)} ${gasPrice} gwei`;
    output += `\n> ${"value sent:".padEnd(20)} ${web3.utils.fromWei(transaction.value)} ETH`
    // output += `\n> ${'total cost:'.padEnd(20)} ${web3.utils.fromWei(totalCost)} ETH`;
    output = output.replace(/\n/g, "\n   ")
    output += "\n"

    console.log(output)

    return tx
  }
}
