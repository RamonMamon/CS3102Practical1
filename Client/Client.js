"use strict"
const dgram = require('dgram');
const client = dgram.createSocket('udp4');
// const Processor = require('./Processor');
const fs = require('fs');
const Stream = require('stream');
const fileStream = new Stream.Readable({
    read(size){
        // Empty body;
    }
});
const Speaker = require('speaker');
const speaker = new Speaker();

// Client's address information
const port = 41236;

// Protocol messages
const START_TRANSFER = 0;
const PACKET_INFO_INDEX = 1;
const PARTITION_PACKET = 2;
const INITIATE_TRANSFER = 3;
const PARTITION_FINISHED = 4;
const FILE_TRANSFERRED = 5;
const MISSING_PACKET = 6;

const REQUEST_INTERVAL = 1000;
const NO_DATA = 0;

// Server Info
let serverPort;
let serverAddress;

let partitionOffset = 0;
let defaultPartitionSize;
let requestInterval;

let file;
let filename;
let chunks;
let flushing = false;

let startTime, endTime, totalTime;

(() => {
    let args = process.argv;
    // If the number of args is less than 4 then throw error.
    if (args.length < 4)
    {
        console.log('Usage: node Client.js <Server Address> <Server Port> [Optional: FileName.wav]')
        process.exit(0);
    }

    serverAddress = args[2];
    serverPort = args[3];
    filename = (args.length < 5)? 'output.wav': args[4];
    file = fs.createWriteStream(filename);
    fileStream.pipe(file);
    fileStream.pipe(speaker);
    client.bind(port);    
})();


client.on('message', (message, remote)=>{
    let header = message.slice(0,1).readUInt8(0);
    
    switch(true)
    {
        case header == PACKET_INFO_INDEX:
            // Save any important information then initiate transfer.
            clearInterval(requestInterval);

            let partitionSize = message.slice(1,5).readUInt16BE(0);
            defaultPartitionSize = partitionSize;
            chunks = new Array(partitionSize).fill(NO_DATA);
            
            // Requests for the first partition.
            console.log('File details received. File transfer initiated.');
            console.log('Partition Size is ' + partitionSize);

            let nextPartition = Buffer.allocUnsafe(4);
            nextPartition.writeUInt16BE(0);
            sendPacket(INITIATE_TRANSFER, nextPartition, remote, true);

            totalTime = new Date();
            startTime = new Date();
            break;

        case header == PARTITION_PACKET:
            // Starts storing the data into a buffer once the file details are received.            
            let index = message.slice(1, 5).readUInt16BE(0);
            let data = message.slice(5);
            
            // The index of the packet in the partition
            let offset = defaultPartitionSize * partitionOffset;
            let partitionIndex = index - offset;

            // Stores the data if it does not already exist.
            if(chunks[partitionIndex] == NO_DATA)
                chunks[partitionIndex] = data;
            
            break;

        case header == PARTITION_FINISHED:
            // Processes the current partition and creates a new partition of the received Size.
            clearInterval(requestInterval)

            let missing = chunks.indexOf(NO_DATA);
            if(missing > -1)
            {
                // Sends a negative acknowledgement for any missing packets.
                let missingBuffer = Buffer.allocUnsafe(4);
                let partitionBuffer = Buffer.allocUnsafe(4);

                missingBuffer.writeUInt16BE(missing);
                partitionBuffer.writeUInt16BE(partitionOffset);
                let length = missingBuffer.length + partitionBuffer.length;

                let data = Buffer.concat([missingBuffer, partitionBuffer], length);
                sendPacket(MISSING_PACKET, data, remote, false);
            }else
            {
                // Flushes the partition if it is complete.
                let nextSize = message.slice(1,5).readUInt16BE(0);

                flushPartition(nextSize, ()=>{
                    console.log('Requesting for Partition '  + partitionOffset); 

                    let partitionBuffer = Buffer.allocUnsafe(4);
                    partitionBuffer.writeUInt16BE(partitionOffset);
                    sendPacket (INITIATE_TRANSFER, partitionBuffer, remote, false);
                });
            }
            break;

        case header == FILE_TRANSFERRED:
            // Once the file is fully received, the client is triggered to close.
            sendPacket (FILE_TRANSFERRED, null, remote, false);
            close();
            break;

        default:
            console.log('Unknown Command.');
    }
});

/**
 * Fixes any errors in the file and flushes it out to the output buffer.
 * @param {String} serverAddress
 * @param {Integer} serverPort
 * @param {Integer} nextPartitionSize
 */
function flushPartition(nextPartitionSize, callback)
{
    if(flushing == false){
        // Waits for the missing packets to be retreived before flushing the buffered packets.
        flushing = true;
        
        endTime = new Date();
        let processTime = (endTime - startTime)/1000;
        startTime = new Date()

        console.log('Processed partition ' + partitionOffset + ' in ' + processTime + ' seconds');
        partitionOffset++;

        // Writes the processed partition to the the readable stream buffer
        chunks.forEach((element) =>{
            fileStream.push(element)
        });

        // Creates a new partition of a specified size.
        chunks = new Array(nextPartitionSize).fill(NO_DATA);
        flushing = false;
        callback();
    }
}

client.on('listening', ()=>{
    console.log('Client is requesting on ' + client.address().address + ':' + port);
    console.log('Client is attempting to stream audio from ' + serverAddress + ':' + serverPort);
    let remote = {
        'address':serverAddress,
        'port':serverPort
    }

    sendPacket(START_TRANSFER, null, remote, true);
})  

/**
 * Error handling.
 */
client.on('error', (err) => {
    console.log(err.stack);
    client.close();
})

/**
 * Sends a message to the specified server following a specific protocol.
 * @param {String} header Is the Protocol message that the message follows
 * @param {Object} body Is the data in to be sent to the server
 * @param {Object} remote The server details.
 * @param {Bool} essential Is true if the packet is needs guaranteed retreival.
 */
function sendPacket(header, body, remote, essential)
{
    let packet = makePacket(header,body);
    client.send(packet, remote.port, remote.address)
    if(essential)
    {
        // Checks if essential packets have been acknowledged by the server.
        requestInterval = setInterval(()=>{
            console.log('Timeout on Partition ' + body);
            console.log('Attempting to reconnect...');
            client.send(packet, remote.port, remote.address);
        }, REQUEST_INTERVAL);
    }
}

/**
 * Closes the client when the song has finished.
 * @param {Object} client 
 */
function close()
{
    clearInterval(requestInterval)
    console.log('Transferred file in ' + (endTime-totalTime)/1000 + ' seconds');
    console.log('File fully received.');

    // Ends the read stream.
    fileStream.push(null);
    console.log('Waiting for audio to finish.');
    speaker.on('finish', ()=>{
        console.log('File Outputted as ' + filename);
        console.log('Closing client.');
        file.end();
        client.close();
    })
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
    return Buffer.concat([headerBuffer, body], (headerBuffer.length + body.length));
}