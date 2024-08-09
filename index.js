const express = require('express');
const admin = require('firebase-admin');
const { DateTime } = require('luxon');
const fs = require('fs');

// Initialize Firebase Admin SDK
const serviceAccount = require('./hikingalert-260bf-firebase-adminsdk-8rkbb-24973cba1e.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();

// Log function to write logs to a file
function writeLog(message) {
    const logMessage = `${DateTime.now().toISO()}: ${message}\n`;
    fs.appendFileSync('cronjob.log', logMessage);
}

// Function to perform a single Firestore operation
async function singleFirestoreOperation() {
    try {
        const startTime = DateTime.now();
        
        // Example operation: Add a single log entry to Firestore
        await db.collection('CronJobLogs').add({
            "CronJobLogs": "Test operation",
            "TimeOfCronLog": DateTime.now().toISO()
        });

        const endTime = DateTime.now();
        writeLog(`Single Firestore operation completed in ${endTime.diff(startTime, 'seconds').toObject().seconds} seconds.`);
        return 'OK';
    } catch (error) {
        writeLog(`Error performing single Firestore operation: ${error.message}`);
        return 'Error';
    }
}

app.get('/', async (req, res) => {
    try {
        const result = await singleFirestoreOperation();
        return res.status(200).send(result);
    } catch (error) {
        writeLog(`Error in endpoint: ${error.message}`);
        return res.status(500).send('Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    writeLog(`Server is running on port ${PORT}`);
});
