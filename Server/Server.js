"use strict"
const fs = require('fs');
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');

// Protocol messages
const START_TRANSFER = 0;
const PACKET_INFO_INDEX = 1;
const PARTITION_PACKET = 2;
const INITIATE_TRANSFER = 3;
const PARTITION_FINISHED = 4;
const FILE_TRANSFERRED = 5;
const MISSING_PACKET = 6;

// Server port
let port;

// File Information
let path = './AudioFiles/'
let filename;
let file;
let filebuffer = [];
let packetsPerPartition;
let numChunks;

let resendUnacked;
let missedPartition = 0;
let missedPacket = 0;

(function (){
    let args = process.argv;
    // If the number of args is less than 4 then throw error.
    if (args.length < 4)
    {
        console.log('Usage: node Server.js <Server Port> <Filename>')
        process.exit(0);
    }

    port = args[2];
    filename = args[3];

    file = fs.readFileSync(path + filename);
    socket.bind(port);   
})();

/**
 * Loads the file once the server is running.
 */
socket.on('listening', () => {
    let address = socket.address();
    console.log('Buffering audio file...');
    bufferFile();
    console.log(packetsPerPartition);
    console.log(filename + " hosted on " + address.address + ':' + address.port);
});

/**
 * Error handling.
 */
socket.on('error', (err) => {
    console.log(err.stack);
    socket.close();
})

socket.on('message', (message, remote)=>{
    let packet;
    let header = message.slice(0,1).readUInt8(0);
    switch(true)
    {
        case header == START_TRANSFER:
            // Sends the file details 
            console.log('Streaming to ' + remote.address + ':' + remote.port);
            console.log('Sending Partitions...');

            let numberOfPackets = Buffer.allocUnsafe(4);
            numberOfPackets.writeUInt16BE(packetsPerPartition);
            packet = makePacket(PACKET_INFO_INDEX,numberOfPackets);

            console.log('Sending File Details')
            socket.send(packet, remote.port, remote.address)
            break;
        case header == INITIATE_TRANSFER:
            // Sends a specified partition of the file.
            clearInterval(resendUnacked);
            let data = message.slice(1).readUInt16BE(0);
            if (data < filebuffer.length) 
            {
                // Sends the unacked packets when the timeout expires.
                resendUnacked = setInterval(()=>{
                    console.log('Timed out at ' + missedPartition);
                    sendPacket(missedPacket, missedPartition, false, remote);
                }, 100)
                console.log('Initiate Transfer of partition ' + data)
                sendPacket(0, data, false, remote);
            }
            
            break;
        case header == MISSING_PACKET:
            // Sends the missed packets.
            missedPacket = message.slice(1,5).readUInt16BE(0);
            missedPartition = message.slice(5,9).readUInt16BE(0);

            // Sends the packet information again if it hasn't been received.
            sendPacket(missedPacket, missedPartition, false , remote);
            break;
        case header == FILE_TRANSFERRED:
            console.log('File has been fully transmitted.');
            clearInterval(resendUnacked);
            break;

        default:
            console.log('Unknown command.');
    }
})

/**
 * Sends a number of packets starting from the stored index.
 * @param {Integer} index 
 * @param {Integer} partitionIndex
 * @param {Bool} sendOne
 * @param {Object} remote 
 */
function sendPacket(index, partitionIndex, sendOne, remote)
{
    let partition = filebuffer[partitionIndex]
    let packet;

    if(index >= partition.length)
    { 
        // Sends the information of the next partition once the end of the current partition is reached.
        let header = (partitionIndex == filebuffer.length - 1 )? FILE_TRANSFERRED : PARTITION_FINISHED;
        let nextSize = (partitionIndex == filebuffer.length - 1)? 0 : filebuffer[partitionIndex + 1].length;
        let nextSizeBuffer = Buffer.allocUnsafe(4);
        nextSizeBuffer.writeUInt16BE(nextSize);
        
        packet = makePacket(header, nextSizeBuffer);
        socket.send(packet, remote.port, remote.address,(err)=>{
            if(err)throw err;
            console.log('Partition ' + partitionIndex + ' empty.');
        });
    }else
    {
        // Sends packets in the partition.
        packet = makePacket(PARTITION_PACKET, partition[index++]);    
    
        socket.send(packet, remote.port, remote.address,(err)=>{
            if(err)throw err;        
            if(!sendOne ) sendPacket(index, partitionIndex,sendOne, remote);            
        });
    }

}

/**
 * Stores the file in partitions which represent a percentage of a file. 
 * These partitions of packets are then stored in a buffer to be sent later.
 */
function bufferFile()
{
    let filesize = file.length;
    let chunkSize = 1024;
    numChunks = Math.ceil(filesize/chunkSize, chunkSize);
    let chunkIndex = 0; 

    // Divides the number of packets into percentages.
    const numPartitions = 100;
    packetsPerPartition = Math.ceil(numChunks/numPartitions);
    let partition = new Array();
    
    
    while(chunkIndex < numChunks)
    {
        // Stores the packet into a partition.
        let offset = chunkIndex * chunkSize;
        let fileSlice = file.slice(offset, chunkSize + offset);

        // Writes the index to a 4 byte sequence number.
        let indexBuffer = Buffer.allocUnsafe(4);
        indexBuffer.writeUInt16BE(chunkIndex);
        let totalLength = indexBuffer.length + fileSlice.length;

        // Stores the new packet into the partition
        let buffer = Buffer.concat([indexBuffer, fileSlice], totalLength);
        partition.push(buffer);
        chunkIndex++;
        
        if(((chunkIndex % packetsPerPartition) == 0 && chunkIndex != 0) || chunkIndex == numChunks-1)
        {
            // Adds the partition into the filebuffer when it is full or if it is the 
            // last partition of the file.
            filebuffer.push(partition);        
            partition = new Array();
        }
    }
}

/**
 * Creates a packet from a buffer with its type indicated by its first byte (header).
 * Any following information specific to the type of packet should be appended after it.
 * @param {Integer} header One of the message protocols
 * @param {Buffer} body A buffer containing the data that will be sent.
 */
function makePacket(header, body)
{
    let headerBuffer = Buffer.allocUnsafe(1);
    headerBuffer.writeUInt8(header);
    if(body == null) return headerBuffer;
    return Buffer.concat([headerBuffer, body], (headerBuffer.length + body.length))
}
