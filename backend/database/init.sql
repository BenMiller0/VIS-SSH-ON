 -- Test Configurations

    CREATE TABLE test_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL, -- 'thermal' or 'custom'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Test Parameters

    CREATE TABLE test_parameters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_config_id INTEGER,
        key TEXT,
        value TEXT,
        FOREIGN KEY (test_config_id) REFERENCES test_configs(id)
    );

    -- Test Runs

    CREATE TABLE test_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_config_id INTEGER,
        start_time DATETIME,
        end_time DATETIME,
        status TEXT DEFAULT 'running', -- 'pass', 'fail', 'killed'
        failure_reason TEXT,
        FOREIGN KEY (test_config_id) REFERENCES test_configs(id)
    );

    -- Test Reports

    CREATE TABLE test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_run_id INTEGER,
        metric TEXT,
        value TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (test_run_id) REFERENCES test_runs(id)
    );