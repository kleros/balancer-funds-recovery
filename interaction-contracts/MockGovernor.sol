pragma solidity ^0.5.12;

/* Mock governor based on KlerosGovernor without arbitration capabilities for testing purposes */
contract MockGovernor {
    struct Transaction {
        address target; // The address to call.
        uint value; // Value paid by governor contract that will be used as msg.value in the execution.
        bytes data; // Calldata of the transaction.
        bool executed; // Whether the transaction was already executed or not.
    }

    struct Submission {
        address submitter; // The one who submits the list.
        uint deposit; // Value of the deposit paid upon submission of the list.
        Transaction[] txs; // Transactions stored in the list in the form txs[_transactionIndex].
        bytes32 listHash; // A hash chain of all transactions stored in the list. This is used as a unique identifier within a session.
    }

    Submission submission;

    function submitList (address[] memory _target, uint[] memory _value, bytes memory _data, uint[] memory _dataSize, string memory _description) public payable {
        require(_target.length == _value.length, "Incorrect input. Target and value arrays must be of the same length.");
        require(_target.length == _dataSize.length, "Incorrect input. Target and datasize arrays must be of the same length.");

        // Reset submission
        submission.txs.length = 0;

        submission.submitter = msg.sender;

        // Using an array to get around the stack limit.
        // 0 - List hash.
        // 1 - Previous transaction hash.
        // 2 - Current transaction hash.
        bytes32[3] memory hashes;
        uint readingPosition;
        for (uint i = 0; i < _target.length; i++) {
            bytes memory readData = new bytes(_dataSize[i]);
            Transaction storage transaction = submission.txs[submission.txs.length++];
            transaction.target = _target[i];
            transaction.value = _value[i];
            for (uint j = 0; j < _dataSize[i]; j++) {
                readData[j] = _data[readingPosition + j];
            }
            transaction.data = readData;
            readingPosition += _dataSize[i];
            hashes[2] = keccak256(abi.encodePacked(transaction.target, transaction.value, transaction.data));
            require(uint(hashes[2]) >= uint(hashes[1]), "The transactions are in incorrect order.");
            hashes[0] = keccak256(abi.encodePacked(hashes[2], hashes[0]));
            hashes[1] = hashes[2];
        }

        submission.listHash = hashes[0];
    }

    function executeTransactionList(uint _listID, uint _cursor, uint _count) public {
        for (uint i = _cursor; i < submission.txs.length && (_count == 0 || i < _cursor + _count); i++) {
            Transaction storage transaction = submission.txs[i];
            uint expendableFunds = getExpendableFunds();
            if (!transaction.executed && transaction.value <= expendableFunds) {
                (bool callResult,) = transaction.target.call.value(transaction.value)(transaction.data); // solium-disable-line security/no-call-value
                // An extra check to prevent re-entrancy through target call.
                if (callResult == true) {
                    require(!transaction.executed, "This transaction has already been executed.");
                    transaction.executed = true;
                }
            }
        }
    }

    function getExpendableFunds() public view returns (uint) {
        return address(this).balance;
    }
}