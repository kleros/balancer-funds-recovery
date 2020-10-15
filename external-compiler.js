#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const util = require("util")

const solc = require("solc")
const abi = require("solc/abi")
const loadVersion = util.promisify(solc.loadRemoteVersion)

const compilationList = require("./compilation-list")

const OUTPUT_DIR = "./output"
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR)
const BUILD_ARTIFACTS_DIR = "./build/contracts"
if (!fs.existsSync(BUILD_ARTIFACTS_DIR)) fs.mkdirSync(BUILD_ARTIFACTS_DIR, { recursive: true })

const libraryList = ["SortitionSumTreeFactory"]

;(async () => {
  for (let compilation of compilationList) {
    const compiler = await loadVersion(compilation.solcVersion)

    let output = compiler.compile(JSON.stringify(compilation.input))
    output = JSON.parse(output)

    // Print errors
    if (output.errors)
      for (const err of output.errors)
        console.error(err.formattedMessage.replace(/(.+)/gm, "    \x1b[2m$1\x1b[0m")) // Additional formatting

    for (let source of Object.keys(output.contracts)) {
      console.log(`Compiled '${source}'`)
      for (let contract of Object.keys(output.contracts[source])) {
        console.log(` > ${contract}`)

        const contractObj = output.contracts[source][contract]
        if (contractObj.evm.bytecode.object === "")
          // Skip abstract contracts
          continue
        // Because of a what seems to be a bug in truffle's ABI schema validation,
        // libraries cannot be compiled externally, so skip them
        //   Details: truffle validation of produced ABI's JSON interfaces enforces
        //     function parameters to have a standard type, which is not the case for
        //     libraries taking a storage reference as paramenter
        //   Workaround: In our case the problem only arise with SortitionSumTreeFactory
        //     so rather than parsing solidity files for libraries or validating
        //     the ABI's JSON interface, directly copy the artifact to the build folder
        let dir = OUTPUT_DIR
        if (libraryList.indexOf(contract) !== -1) dir = BUILD_ARTIFACTS_DIR

        // Differentiate interaction contract from those compiled by truffle's solc
        contract = "x" + contract
        const metadata = JSON.parse(contractObj.metadata)
        const artifact = {
          contractName: contract,
          abi: abi.update(
            compilation.solcVersion.match(/^v([0-9]+\.[0-9]+\.[0-9]+)\+commit\.[0-9a-f]{8}$/)[1],
            contractObj.abi
          ),
          bytecode: "0x" + contractObj.evm.bytecode.object,
          compiler: { name: "solcjs", version: metadata.compiler.version },
          deployedBytecode: "0x" + contractObj.evm.deployedBytecode.object,
          deployedSourceMap: contractObj.evm.deployedBytecode.sourceMap,
          devdoc: contractObj.devdoc,
          metadata: contractObj.metadata,
          source: compilation.input.sources[source].content,
          sourceMap: contractObj.evm.bytecode.sourceMap,
          userdoc: contractObj.userdoc
        }
        fs.writeFileSync(path.join(dir, contract + ".json"), JSON.stringify(artifact))
      }
    }
  }
})()
