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

const REQUEST_INTERVAL = 1500;
const RETRY_ATTEMPTS = 4;
const NO_DATA = 0;

let serverPort;
let serverAddress;

let processor;
let totalPackets;
let receivedDetails;
let defaultPartitionSize;
let requestInterval;

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
    udpImplementation( message, remote);
    // tcpLikeImplementation(message,remote)
});


client.on('listening', ()=>{
    
    console.log('Client is requesting on ' + client.address().address + ':' + port);
    console.log('Client is attempting to stream audio from ' + serverAddress + ':' + serverPort);
    let remote = {
        'address':serverAddress,
        'port':serverPort
    }
    sendPacket(START_TRANSFER, null, remote, true);

    //TCP
    // client.send(START_TRANSFER, serverPort, serverAddress);
    // processor.newPartition(37545)
})  

/**
 * Error handling.
 */
client.on('error', (err) => {
    console.log(err.stack);
    client.close();
})

/**
 * TODO: Think of a good comment for this function.
 * @param {Object} message 
 * @param {Object} remote 
 */
function udpImplementation (message, remote)
{
    let packet = JSON.parse(message)
    let header = packet.header; 
    let body = packet.body;
    
    switch(true)
    {
        case header == PACKET_INFO_INDEX:
            // Saves the file details.
            clearInterval(requestInterval);
            totalPackets = body.totalPackets;
            processor.newPartition(body.partitionSize);
            defaultPartitionSize = body.partitionSize;
            processor.partitionSize = defaultPartitionSize;
            // receivedDetails = true;
            
            // Requests for the first partition.
            console.log('File details received. File transfer initiated.');
            console.log('Partition Size is ' + processor.getPartitionSize());
            sendPacket(INITIATE_TRANSFER, 0, remote, true);
            break;

        case header == PARTITION_PACKET:
            // Starts storing the data into a buffer once the file details are received.
            clearInterval(requestInterval);
            let index = body.index;
            let data = Buffer.from(body.data);
            
            // The index of the packet in the partition
            let offset = defaultPartitionSize * processor.getPartitionOffset();
            let partitionIndex = index - offset;

            // Stores the data if it does not already exist.
            if(processor.chunks[partitionIndex] == NO_DATA){
                processor.incrementPartitionCount();
                processor.chunks[partitionIndex] = data
            }
            break;

        case header == PARTITION_FINISHED:
            // Processes the current partition and creates a new partition of the received Size.
            console.log('Processing Partition '  + processor.getPartitionOffset()); 

            processor.flushPartition(serverAddress, serverPort, body, sendPacket, INITIATE_TRANSFER, remote, true);
            
            // THIS IS BEING CALLED EVEN BEFORE THE PARTITION IS FLUSHED
            // sendPacket(INITIATE_TRANSFER, processor.getPartitionOffset(), remote, true);
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
}

/**
 * Sends a message to the specified server following a specific protocol.
 * @param {String} header is the Protocol message that the message follows
 * @param {Object} body is the data in to be sent to the server
 * @param {Object} remote the server details;
 * @param {Bool} essential Is true if the pa        this.partitionSize = 0;be guaranteed to be received.
 */
function sendPacket(header, body, remote, essential)
{
    let packet = processor.makePacket(header,body);
    client.send(JSON.stringify(header), remote.port, remote.address)
    if(essential)
    {
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

function tcpLikeImplementation(message, remote)
{
    
    if(message == 'Package delivered.')
    {
        // Saves the file once the full package has been received.
        processor.chunks.forEach((element)=>{ 
            processor.write(element);
        });
        // file.end();
        // console.log('File successfully saved as ' + Buffer.from(filename));
        console.log('Number of Packets received ' + processor.chunks.length)
        // Terminates the client
        processor.close(client);
        
    }else
    {
        // Stores the packet in a buffer
        let packet = JSON.parse(message.toString())
        let data = Buffer.from(packet.data);
        if(processor.chunks[packet.index] == 0)
        {
            processor.chunks.splice(packet.index, 1, data);
            processor.write(data);
        }
        
        // Sends an ACK to the server.
        console.log('Received packet ' + packet.index);
        client.send(packet.index.toString(), remote.port, remote.address);
    }
}