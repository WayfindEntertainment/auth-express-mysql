const createDebug = require('debug')
const mysql = require('mysql')
const { Store } = require('express-session')

/**
 * Used to help with various debug messaging throughout the program.
 * @example
 * debug.log('This is my error message description')
 */
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

/**
 * Used in Express apps as an interface for an external session store residing in a MySQL database.
 * 
 * Once properly configured, it is designed to silently handle errors. This way, any issues that arise during operation
 * will fail gracefully without taking the entire application offline.
 * @param {object} configOptions An optional object describing the session settings. These can also be set using
 * environment variables, or omitted to use the defaults. See the `README` for more configuration information.
 * @example
    const configOptions = {
        host: 'localhost',
        port: 3306,
        user: 'auth_express_mysql_test_user',
        password: 'password123456',
        database: 'auth_express_mysql_testing',
        tableName: 'SESSIONS',
        columnNames: {
            sessionID: 'SESSION_ID',
            expires: 'EXPIRES',
            data: 'DATA',
            user: 'USER'
        }
    }
    const sessionStore = new AuthExpressStore(configOptions)
 
    app.use(
        session({
            store: sessionStore,
            name: 'sessionID',
            secret: 'my_session_secret',
            resave: false,
            saveUninitialized: false,
            rolling: true,
            cookie: {
                secure: true,
                httpOnly: true,
                domain: process.env.HOST || 'localhost',
                maxAge: 14 * 24 * 60 * 60 * 1000 // 14 days
            }
        })
    )
 */
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

    /**
     * Provides basic error checking and cleaning up over user provided config info. If there are irreperable problems
     * with the user's configuration, this class will throw an error. This error occurs at server startup, therefore an
     * interuption in service is deniable before the system is placed online.
     * @private
     * @returns {void}
     */
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

    /**
     * Uses the store's configuration settings to connect to the MySQL database. If the database is inaccessible, it
     * will log the issue through `debug`, but otherwise will not cause further disruption.
     * @private
     * @returns {void}
     */
    connectToDatabase() {
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

    /**
     * Attempts to close the database connection. If called when the connection is inactive, it does nothing.
     * @private
     * @returns {void}
     */
    closeDatabaseConnection() {
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
     * @private
     * @returns {void}
     */
    finalCallback(callback, error, data) {
        let safeCallback = callback
        if (typeof safeCallback !== 'function') {
            safeCallback = () => {}
        }
        this.closeDatabaseConnection()
        safeCallback(error, data)
    }

    /**
     * Returns *all* sessions in the store that not expired. Use the `expired` method to get only the unexpired sessions.
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error, result)`
     */
    all(callback) {
        const sql = 'SELECT * FROM ?? WHERE ?? >= ?'
        // Get all info from all sessions that are not expired
        const params = [this.settings.tableName, this.settings.columnNames.expires, Date.now()]
        this.connectToDatabase()

        this.connection.query(sql, params, (error, result) => {
            if (error) {
                debug.error(`Cannot retrieve all sessions: ${error.message}`)
                return this.finalCallback(callback, error)
            }

            debug.log(`Retrieved ${result.length} unexpired sessions.`)
            return this.finalCallback(callback, error, result)
        })
    }

    /**
     * This method deletes *ALL* sessions from the store. Use the `expiredClear` method to delete *only* expired sessions.
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error)`
     */
    clear(callback) {
        const sql = 'TRUNCATE ??'
        const params = [this.settings.tableName]
        this.connectToDatabase()

        this.connection.query(sql, params, (error, result) => {
            if (error) {
                debug.error(`Cannot clear all sessions: ${error.message}`)
                return this.finalCallback(callback, error)
            }

            debug.log(`Cleared all sessions: ${result}`)
            return this.finalCallback(callback)
        })
    }

    /**
     * Destroys the session with the given session ID.
     * @param {string} sessionID The unique identifier for the session
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error)`
     */
    destroy(sessionID, callback) {
        const sql = 'DELETE FROM ?? WHERE ?? = ?'
        const params = [this.settings.tableName, this.settings.columnNames.sessionID, sessionID]
        this.connectToDatabase()
        this.connection.query(sql, params, (error, result) => {
            if (error) {
                debug.error(`Session ${sessionID} cannot be deleted: ${error.message}`)
                return this.finalCallback(callback, error)
            }

            if (result.affectedRows !== 0) {
                debug.log(
                    `Session ${sessionID} successfully destroyed. Client result: ${JSON.stringify(
                        result
                    )}`
                )
            } else {
                debug.log(
                    `Nothing to destroy, session ${sessionID} did not exist. Client result: ${JSON.stringify(
                        result
                    )}`
                )
            }

            return this.finalCallback(callback, error)
        })
    }

    /**
     * Gets the session (if not expired) from the store given a session ID and passes it to callback.
     *
     * The `session` argument should be a `Session` object if found, otherwise `null` or `undefined` if the session was not
     * found and there was no error. A special case is made when `error.code === 'ENOENT'` to act like `callback(null, null)`.
     * @param {string} sessionID The unique identifier for the session
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error, sessionData)`
     */
    get(sessionID, callback) {
        const sql = 'SELECT ?? FROM ?? WHERE ?? = ? AND ?? >= ?'
        const params = [
            this.settings.columnNames.data,
            this.settings.tableName,
            this.settings.columnNames.sessionID,
            sessionID,
            this.settings.columnNames.expires,
            Date.now()
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
                sessionData.cookie.expires = new Date(Date.parse(sessionData.cookie.expires)) // Required to convert bigint back to cookie based string
                return this.finalCallback(callback, error, sessionData)
            }
            return this.finalCallback(callback, error)
        })
    }

    /**
     * This method returns *only* the count of unexpired sessions. Use the `expiredLength` method count only expired sessions.
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error, length)`
     */
    length(callback) {
        const sql = 'SELECT COUNT(*) AS LEN FROM ?? WHERE ?? >= ?'
        // Get all info from all sessions that are not expired
        const params = [this.settings.tableName, this.settings.columnNames.expires, Date.now()]
        this.connectToDatabase()

        this.connection.query(sql, params, (error, result) => {
            if (error) {
                debug.error(`Cannot get length of all active sessions: ${error.message}`)
                return this.finalCallback(callback, error)
            }

            debug.log(`Identified ${result.length} unexpired sessions.`)
            return this.finalCallback(callback, error, result[0].LEN)
        })
    }

    /**
     * Upsert a session in the store given a session ID and SessionData.
     * If the session already exists, ignore it. The `touch` function will handle updates.
     * @param {string} sessionID Unique identifier for the session
     * @param {object} session Session data to be parsed by `express-session`
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error)`
     */
    set(sessionID, session, callback) {
        const sessionData = JSON.stringify(session)
        const timeExpires = session.cookie.expires
        const sql = 'INSERT IGNORE INTO ?? (??, ??, ??, ??) VALUES (?, ?, ?, ?)'
        const params = [
            this.settings.tableName,
            this.settings.columnNames.sessionID,
            this.settings.columnNames.data,
            this.settings.columnNames.expires,
            this.settings.columnNames.user,
            sessionID,
            sessionData,
            Date.parse(timeExpires),
            session.passport?.user
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

    /**
     * "Touches" a given session, resetting the idle timer.
     * @param {string} sessionID Unique identifier for the session
     * @param {object} session Session data to be parsed by `express-session`
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error)`
     */
    touch(sessionID, session, callback) {
        const sessionData = JSON.stringify(session)
        const timeExpires = session.cookie.expires
        const sql = 'UPDATE ?? SET ?? = ?, ?? = ? WHERE ?? = ?'
        const params = [
            this.settings.tableName,
            this.settings.columnNames.data,
            sessionData,
            this.settings.columnNames.expires,
            Date.parse(timeExpires),
            this.settings.columnNames.sessionID,
            sessionID
        ]

        this.connectToDatabase()
        this.connection.query(sql, params, async (error, result) => {
            if (error) {
                debug.error(`Cannot touch Session ID ${sessionID}. ${error.message}`)
            } else {
                debug.log(`Session ID ${sessionID} successfully touched.`)
                debug.log(`Client result: ${JSON.stringify(result)}`)
            }
            return this.finalCallback(callback, error)
        })
    }

    /**
     * Returns *only* the expired sessions. Use the `all` method to get only the unexpired sessions.
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error, result)`
     */
    expired(callback) {
        const sql = 'SELECT * FROM ?? WHERE ?? < ?'
        // Get all info from all sessions that ARE expired
        const params = [this.settings.tableName, this.settings.columnNames.expires, Date.now()]
        this.connectToDatabase()

        this.connection.query(sql, params, (error, result) => {
            if (error) {
                debug.error(`Cannot retrieve expired sessions: ${error.message}`)
                return this.finalCallback(callback, error)
            }

            debug.log(`Retrieved ${result.length} expired sessions.`)
            return this.finalCallback(callback, error, result)
        })
    }

    /**
     * This method returns *only* the count of expired sessions. Use the `length` method count only unexpired sessions.
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error, length)`
     */
    expiredLength(callback) {
        const sql = 'SELECT COUNT(*) AS LEN FROM ?? WHERE ?? < ?'
        // Get all info from all sessions that ARE expired
        const params = [this.settings.tableName, this.settings.columnNames.expires, Date.now()]
        this.connectToDatabase()

        this.connection.query(sql, params, (error, result) => {
            if (error) {
                debug.error(`Cannot get length of all expired sessions: ${error.message}`)
                return this.finalCallback(callback, error)
            }

            debug.log(`Identified ${result.length} expired sessions.`)
            return this.finalCallback(callback, error, result[0].LEN)
        })
    }

    /**
     * This method deletes *only* the expired sessions. Use the `clear` to delete *all* sessions.
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error)`
     */
    expiredClear(callback) {
        const sql = 'DELETE FROM ?? WHERE ?? < ?'
        const params = [this.settings.tableName, this.settings.columnNames.expires, Date.now()]
        this.connectToDatabase()

        this.connection.query(sql, params, (error, result) => {
            if (error) {
                debug.error(`Cannot clear all expired sessions: ${error.message}`)
                return this.finalCallback(callback, error)
            }

            debug.log(`Cleared all expired sessions: ${result}`)
            return this.finalCallback(callback)
        })
    }

    /**
     * This method deletes *all sessions*, expired or not, for the specified user. Use the `destroy` method to delete
     * a single session based on session ID. This method would typically be used to log a user out of all previously
     * stored sessions across multiple devices.
     * @param {string} user The user to destroy all sessions for. Typically an email address.
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error)`
     */
    destroyUser(user, callback) {
        const sql = 'DELETE FROM ?? WHERE ?? = ?'
        const params = [this.settings.tableName, this.settings.columnNames.user, user]
        this.connectToDatabase()

        this.connection.query(sql, params, (error, result) => {
            if (error) {
                debug.error(`Cannot clear all sessions for user '${user}': ${error.message}`)
                return this.finalCallback(callback, error)
            }

            debug.log(`Cleared all sessions for user '${user}': ${result}`)
            return this.finalCallback(callback)
        })
    }

    /**
     * Creates the MySQL session table using the configuration provided during initialization.
     * This is an optional method used to setup this table during runtime if not already done manually beforehand.
     * @param {Function} [callback] The function to execute once complete
     * @returns {void} The data in a callback of form `callback(error)`
     */
    createTable(callback) {
        const sql = `CREATE TABLE IF NOT EXISTS ?? (
            ?? varchar(128) primary key not null,
            ?? bigint not null,
            ?? mediumtext not null,
            ?? varchar(255) not null)`
        const params = [
            this.settings.tableName,
            this.settings.columnNames.sessionID,
            this.settings.columnNames.expires,
            this.settings.columnNames.data,
            this.settings.columnNames.user
        ]
        this.connectToDatabase()
        this.connection.query(sql, params, (error, result) => {
            if (error) {
                debug.error(`Cannot create table '${this.settings.tableName}': ${error.message}`)
                return this.finalCallback(callback, error)
            }

            debug.log(`Created table '${this.settings.tableName}': ${result}`)
            return this.finalCallback(callback)
        })
    }
}

module.exports = { AuthExpressStore, debug, databaseDefaults, schemaDefaults }
