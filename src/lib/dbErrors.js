// SQLite reports every constraint problem with the same code, so the message is what tells
// a duplicate apart from a broken link. MySQL codes are still accepted in case an old
// database is imported.
const isDuplicate = e => !!e && (/UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(e.message || '') || e.code === 'ER_DUP_ENTRY');
const isForeignKey = e => !!e && (/FOREIGN KEY constraint failed/i.test(e.message || '') || e.code === 'ER_NO_REFERENCED_ROW_2');

module.exports = { isDuplicate, isForeignKey };
