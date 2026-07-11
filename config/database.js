// config/database.js
const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/meshflow';
        
        await mongoose.connect(uri);
        console.log(`[DATABASE] MongoDB Connected Successfully`);
    } catch (err) {
        console.error(`[DATABASE ERROR] Connection Failed:`, err.message);
        console.error(`[SYSTEM] MeshFlow X requires a running database. Shutting down...`);
        // PRIORITY 5: Fail fast if MongoDB cannot connect.
        process.exit(1); 
    }
};

module.exports = connectDB;