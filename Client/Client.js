"use strict"
const dgram = require('dgram');
const client = dgram.createSocket('udp4');
const Processor = require('./Processor');

// Client's address information
const port = 41236;
// const host = 'localhost';

// Protocol messages
const START_TRANSFER = 'Start Transfer';
const PACKET_INFO_INDEX = 'Packet Info';
const PARTITION_PACKET = 'Partition Packet';
const INITIATE_TRANSFER = 'Initiate Partition Transfer';
const PARTITION_FINISHED = 'Partition Sent';
const FILE_TRANSFERED = 'Finished';

const REQUEST_INTERVAL = 1000;
const RETRY_ATTEMPTS = 10;
const NO_DATA = 0;

let serverPort;
let serverAddress;

let processor;
let totalPackets;
let receivedDetails;
let defaultPartitionSize;
let requestInterval;
let packetTimeout;

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
    let filename = (args.length < 5)? 'output.wav': args[4];
    processor = new Processor(client, filename);

    client.bind(port);    
})();


client.on('message', (message, remote)=>{
    let packet = JSON.parse(message)
    let header = packet.header; 
    let body = packet.body;
    
    switch(true)
    {
        case header == PACKET_INFO_INDEX:
            // Saves the file details.
            clearInterval(requestInterval);
            // totalPackets = body.totalPackets;
            processor.newPartition(body.partitionSize);
            defaultPartitionSize = body.partitionSize;
            
            // Requests for the first partition.
            console.log('File details received. File transfer initiated.');
            console.log('Partition Size is ' + processor.getPartitionSize());
            sendPacket(INITIATE_TRANSFER, 0, remote, true);
            break;

        case header == PARTITION_PACKET:
            // Starts storing the data into a buffer once the file details are received.
            clearInterval(requestInterval);
            clearTimeout(packetTimeout);
            let index = body.index;
            let data = Buffer.from(body.data);
            
            // The index of the packet in the partition
            let offset = defaultPartitionSize * processor.getPartitionOffset();
            let partitionIndex = index - offset;

            console.log('Received Packet ' + index + ' from Partition ' + processor.getPartitionOffset())

            // Stores the data if it does not already exist.
            if(processor.chunks[partitionIndex] == NO_DATA)
                processor.chunks[partitionIndex] = data;

            // It's possible that we can set a requestInterval timeout here as well that waits 
            // until the next packet is received.
            // If the next packet hasn't been received after a while, then the partition is assumed
            // to be finished, hence processing will commence.
            // packetTimeout = setTimeout(()=>{
            //     console.log('No new packets received after ' + REQUEST_INTERVAL + 'ms');
            //     console.log('Moving on to partition Processing stage.');
            //     console.log('Processing Partition '  + processor.getPartitionOffset());
            //     processor.flushPartition(serverAddress, serverPort, body, ()=>{
            //         console.log('Requesting for Partition '  + processor.getPartitionOffset()); 
            //         sendPacket (INITIATE_TRANSFER, processor.getPartitionOffset(), remote, true)
            //     });
            // }, 1500);
            break;
            // WE MISS PACKETS IN HERE BEFORE THE PARTITION IS SAID TO BE FINISHED.
            // THE CLIENT IS THEN PUT INTO A WAITING PHASE

        case header == PARTITION_FINISHED:
            // Processes the current partition and creates a new partition of the received Size.
            console.log('Processing Partition '  + processor.getPartitionOffset());
            processor.flushPartition(serverAddress, serverPort, body, ()=>{
                console.log('Requesting for Partition '  + processor.getPartitionOffset()); 
                sendPacket (INITIATE_TRANSFER, processor.getPartitionOffset(), remote, true)
            });
            break;

        case header == FILE_TRANSFERED:
            // Once the file is fully received, the client is triggered to close.
            clearInterval(requestInterval)
            console.log('File fully received.');
            processor.close(client);
            break;

        default:
            // Checks if the file details have been received, requests for them if not.
            console.log('File details not found. Requesting again.')
            sendPacket(PACKET_INFO_INDEX, null, remote, false);
    }
});


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
    let packet = processor.makePacket(header,body);
    client.send(JSON.stringify(packet), remote.port, remote.address)
    if(essential)
    {
        // Checks if essential packets have been acknowledged by the server.
        let count = 0;
        requestInterval = setInterval(()=>{
            // Attempts to reconnect to the server after 1500ms
            console.log('Next partition not received after 1500ms.');
            console.log('Attempting to reconnect...');
            client.send(JSON.stringify(packet), remote.port, remote.address);
            if(count == RETRY_ATTEMPTS)
            {
                // Closes Client after a number of retries.
                console.log('Reconnection failed after ' + count + ' tries.');
                clearInterval(requestInterval);
                processor.close(client);
            }
            count++;
        }, REQUEST_INTERVAL);
    }
}