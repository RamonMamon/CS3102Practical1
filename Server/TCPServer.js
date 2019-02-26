"use strict"
const fs = require('fs');
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');

// Protocol messages
const START_TRANSFER = 'Start Transfer';
const PACKET_INFO_INDEX = 'Packet Info';
const PARTITION_PACKET = 'Partition Packet';
const INITIATE_TRANSFER = 'Initiate Partition Transfer';
const PARTITION_FINISHED = 'Partition Sent';
const FILE_TRANSFERED = 'Finished';
const MISSING_PACKET = 'Missing Packet'

// Server port
let port;

// File Information
let path = './AudioFiles/'
let filename;
let file;
let filebuffer = [];
let packetsPerPartition;
let numChunks;
var packetIndex = 0;

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
    // console.log(parseInt(message) + " and Packet index " + packetIndex)
    // When a client asks to be hit up with a song, he shall receive.
    if(packetIndex >= filebuffer.length) 
    {
        // Resets the sent Counter.
        packetIndex = 0; 
        socket.send('Package delivered.', remote.port, remote.address);
        console.log('Package fully transmitted.')
    }
    // Waits for a client to request for a file
    if(message == START_TRANSFER)
    {
        // Sends the buffered file starting from the index 0.
        packetIndex = 0; 
        console.log('Client from ' + remote.address + ':' + remote.port + ' wants some of the good shiz.');

        tcpSendPacket(packetIndex++, remote);
    }else if(parseInt(message) == packetIndex)
    {
        // Sends a packet if the client successfully receives the previous packet
        tcpSendPacket(packetIndex++, remote);
    }else if(parseInt(message) == packetIndex-1)
    {
        // Resends a packet that was lost.
        console.log('Resending portion ' + packetIndex)
        tcpSendPacket(packetIndex, remote);
    }    
});

/**
 * Sends a packet stored at a specific index.
 * @param {Integer} index 
 * @param {Object} remote 
 */
function tcpSendPacket(index, remote){
    if(index < filebuffer.length ){
        console.log('Sending portion ' + index);
        for (let i = 0; i < 1; i++)
            socket.send(JSON.stringify(filebuffer[index]), remote.port, remote.address);
    }
    else {
        console.log('Index empty.');
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
    let index = 0; // Chunk index

    // Divides the number of packets into percentages.
    const numPartitions = 100;
    packetsPerPartition = Math.ceil(numChunks/numPartitions);
    let partition = new Array();
    
    while(index < numChunks)
    {
        // Stores the packet into a partition.
        let offset = index * chunkSize;
        let buffer = file.slice(offset, chunkSize + offset);
        let packet = {
            'index' : index,
            'data' : buffer
        }
        filebuffer.push(packet);
        index++;
    }
}