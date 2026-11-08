const mysql = require('mysql2');
require('dotenv').config({ quiet: true });

// One pool for the whole app: connections are reused between requests.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'inkster_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true // DATE columns come back as 'YYYY-MM-DD' text, not JS Date objects
});

module.exports = pool.promise();
