/* eslint-disable global-require */
const createDebug = require('debug')
const mysql = require('mysql')
const { Store } = require('express-session')

const debug = {
    log: createDebug('auth-express-mysql:log'),
    error: createDebug('auth-express-mysql:error'),
    test: createDebug('auth-express-mysql:RUNNING TEST -')
}
debug.test.color = 10

const databaseDefaults = {
    host: 'localhost',
    port: 3306,
    user: 'auth_express_mysql_test_user',
    password: 'password123456',
    database: 'auth_express_mysql_testing'
}

const schemaDefaults = {
    tableName: 'SESSIONS',
    columnNames: {
        sessionID: 'SESSION_ID',
        expires: 'EXPIRES',
        data: 'DATA',
        user: 'USER'
    }
}

const createTableStatements = `CREATE TABLE SESSIONS (
        SESSION_ID varchar(128) primary key not null,
        EXPIRES bigint not null,
        DATA mediumtext not null,
        USER varchar(255) not null
    )`

class AuthExpressStore extends Store {
    constructor(configOptions) {
        super()
        debug.log('AuthExpressStore is initializing...')
        // Process these setting variables in priority order. Type checking occurs in sanitizeConfiguration()
        this.settings = {
            databaseConfig: {
                host: process.env.HOST || configOptions?.host || databaseDefaults.host,
                port:
                    parseInt(process.env.DATABASE_PORT, 10) || // process.env stores everything as strings. Convert the port back to a number here.
                    configOptions?.port ||
                    databaseDefaults.port,
                user: process.env.DATABASE_USER || configOptions?.user || databaseDefaults.user,
                password:
                    process.env.DATABASE_PASSWORD ||
                    configOptions?.password ||
                    databaseDefaults.password,
                database:
                    process.env.DATABASE_NAME ||
                    configOptions?.database ||
                    databaseDefaults.database
            },
            isAsync: configOptions?.isAsync || true,
            tableName: configOptions?.tableName || schemaDefaults.tableName,
            columnNames: {
                sessionID: configOptions?.columnNames?.sessionID || 'SESSION_ID',
                expires: configOptions?.columnNames?.expires || 'EXPIRES',
                data: configOptions?.columnNames?.data || 'DATA',
                user: configOptions?.columnNames?.user || 'USER'
            }
        }

        this.sanitizeConfiguration()

        debug.log('AuthExpressStore successfully initialized')
    }

    sanitizeConfiguration() {
        debug.log('AuthExpressStore is sanitizing the input configuration...')
        if (typeof this.settings.databaseConfig.host !== 'string') {
            const message = `The database host must be a string. Received: ${typeof this.settings
                .databaseConfig.host}`
            debug.error(message)
            throw Error(message)
        }

        if (typeof this.settings.databaseConfig.port !== 'number') {
            const message = `The database port must be coercible to an integer. Received: ${typeof this
                .settings.databaseConfig.port}`
            debug.error(message)
            throw Error(message)
        }
        this.settings.databaseConfig.port = parseInt(this.settings.databaseConfig.port, 10) // Takes any floats and converts them to integers

        if (typeof this.settings.databaseConfig.user !== 'string') {
            const message = `The database user must be a string. Received: ${typeof this.settings
                .databaseConfig.user}`
            debug.error(message)
            throw Error(message)
        }

        if (typeof this.settings.databaseConfig.password !== 'string') {
            const message = `The database user password must be a string. Received: ${typeof this
                .settings.databaseConfig.password}`
            debug.error(message)
            throw Error(message)
        }

        if (typeof this.settings.databaseConfig.database !== 'string') {
            const message = `The database name must be a string. Received: ${typeof this.settings
                .databaseConfig.database}`
            debug.error(message)
            throw Error(message)
        }

        if (typeof this.settings.tableName !== 'string') {
            const message = `The session table name must be a string. Received: ${typeof this
                .tableName}`
            debug.error(message)
            throw Error(message)
        }

        Object.keys(this.settings.columnNames).forEach((column) => {
            if (typeof this.settings.columnNames[column] !== 'string') {
                const message = `The table column name for ${column} must be a string. Received: ${typeof this
                    .settings.columnNames[column]}`
                debug.error(message)
                throw Error(message)
            }
        })
    }

    async connectToDatabase() {
        this.connection = mysql.createConnection({
            host: this.settings.databaseConfig.host,
            user: this.settings.databaseConfig.user,
            password: this.settings.databaseConfig.password,
            database: this.settings.databaseConfig.database,
            port: this.settings.databaseConfig.port
        })
        this.connection.connect((err) => {
            if (err) {
                debug.error(`Unable to connect to the database: ${err}`)
                return
            }
            debug.log('Successfully connected to the database')
        })
    }

    async closeDatabaseConnection() {
        if (this.connection.state !== 'disconnected') {
            this.connection.destroy()
            debug.log('Successfully closed the database connection')
        }
    }

    /**
     * Shuts down the database connection to avoid lingering processes, then executes the callback function the user
     * specified. If no callback was given, or the callback was not a function, an empty callback will get used insetad.
     * @param {Function} callback The callback function
     * @param {string} error The error string, if applicable
     * @param {object} data the data to return, if applicable
     * @returns {void}
     */
    finalCallback(callback, error, data) {
        if (typeof callback !== 'function') {
            // eslint-disable-next-line no-param-reassign, func-names
            callback = function () {}
        }
        this.closeDatabaseConnection()
        callback(error, data)
    }

    all(callback) {
        return callback()
    }

    clear(callback) {
        return callback()
    }

    destroy(sessionID, callback) {
        const sql = 'DELETE FROM ?? WHERE ?? = ?'
        const params = [this.settings.tableName, this.settings.columnNames.sessionID, sessionID]
        this.connectToDatabase()
        this.connection.query(sql, params, (error, result) => {
            if (error) {
                debug.error(`Session ${sessionID} cannot be deleted: ${error.message}`)
                return this.finalCallback(callback, error)
            }
            debug.log(
                `Session ${sessionID} successfully destroyed. Client result: ${JSON.stringify(
                    result
                )}`
            )

            return this.finalCallback(callback, error)
        })
    }

    get(sessionID, callback) {
        const sql = 'SELECT ?? FROM ?? WHERE ?? = ?'
        const params = [
            this.settings.columnNames.data,
            this.settings.tableName,
            this.settings.columnNames.sessionID,
            sessionID
        ]
        this.connectToDatabase()
        this.connection.query(sql, params, (error, result) => {
            if (error) {
                debug.error(`Session ${sessionID} cannot be fetched: ${error.message}`)
                return this.finalCallback(callback, error)
            }

            if (result.length === 1) {
                debug.log(
                    `Session ${sessionID} successfully fetched. Data: ${JSON.stringify(result[0])}`
                )
                const sessionData = JSON.parse(result[0].DATA)
                return this.finalCallback(callback, error, sessionData)
            }
            return this.finalCallback(callback, error)
        })
    }

    length(callback) {
        return callback()
    }

    set(sessionID, session, callback) {
        const sessionData = JSON.stringify(session)
        const timeExpires = null // new Date(session.cookie.expires)
        const sql =
            'INSERT INTO ?? (??, ??, ??, ??) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE ?? = ?, ?? = ?'
        const params = [
            this.settings.tableName,
            this.settings.columnNames.sessionID,
            this.settings.columnNames.data,
            this.settings.columnNames.expires,
            this.settings.columnNames.user,
            sessionID,
            sessionData,
            timeExpires,
            session.passport?.user,
            this.settings.columnNames.data,
            sessionData,
            this.settings.columnNames.expires,
            timeExpires
        ]

        this.connectToDatabase()
        this.connection.query(sql, params, async (error, result) => {
            if (error) {
                debug.error(`Session ID ${sessionID} cannot be created: ${error.message}`)
            } else {
                debug.log(`Session ID ${sessionID} successfully added to store: ${sessionData}`)
                debug.log(`Client result: ${JSON.stringify(result)}`)
            }
            return this.finalCallback(callback, error)
        })
    }

    touch(sessionID, session, callback) {
        return callback()
    }
}

module.exports = { databaseDefaults, debug, AuthExpressStore }
