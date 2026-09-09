<?php
declare(strict_types=1);

if (!defined('CTS_APP_ROOT')) {
    define('CTS_APP_ROOT', dirname(__DIR__));
}

if (!defined('CTS_DATA_ROOT')) {
    define('CTS_DATA_ROOT', CTS_APP_ROOT . '/data');
}

if (!defined('CTS_CONFIG_ROOT')) {
    define('CTS_CONFIG_ROOT', CTS_APP_ROOT . '/config');
}

if (!defined('CTS_SESSION_NAME')) {
    define('CTS_SESSION_NAME', 'cts_session');
}

if (!defined('CTS_SESSION_IDLE_TIMEOUT')) {
    define('CTS_SESSION_IDLE_TIMEOUT', 12 * 60 * 60);
}

if (!defined('CTS_LOGIN_LOCK_THRESHOLD')) {
    define('CTS_LOGIN_LOCK_THRESHOLD', 5);
}

if (!defined('CTS_LOGIN_LOCK_MINUTES')) {
    define('CTS_LOGIN_LOCK_MINUTES', 15);
}

if (!defined('CTS_DEFAULT_ADMIN_USERNAME')) {
    define('CTS_DEFAULT_ADMIN_USERNAME', 'admin');
}

if (!defined('CTS_DEFAULT_ADMIN_PASSWORD')) {
    define('CTS_DEFAULT_ADMIN_PASSWORD', 'clinicaltrials2024');
}

function cts_init_api(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function cts_json_response(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

function cts_now(): string
{
    return gmdate('c');
}

function cts_read_json_input(): array
{
    static $cachedInput = null;

    if ($cachedInput !== null) {
        return $cachedInput;
    }

    $rawBody = file_get_contents('php://input');
    if ($rawBody === false || trim($rawBody) === '') {
        $cachedInput = [];
        return $cachedInput;
    }

    $decoded = json_decode($rawBody, true);
    if (!is_array($decoded)) {
        cts_json_response([
            'success' => false,
            'message' => 'Invalid JSON request body.'
        ], 400);
    }

    $cachedInput = $decoded;
    return $cachedInput;
}

function cts_get_client_ip(): string
{
    $ip = trim((string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    return $ip !== '' ? $ip : 'unknown';
}

function cts_get_database_path_candidates(): array
{
    $candidates = [];

    $envPath = trim((string)getenv('PHYSICIAN_FORUM_DB_PATH'));
    if ($envPath !== '') {
        $candidates[] = $envPath;
    }

    $outsideRoot = dirname(CTS_APP_ROOT) . '/private/physician_forum.sqlite';
    $insideRoot = CTS_DATA_ROOT . '/physician_forum.sqlite';

    $candidates[] = $outsideRoot;
    $candidates[] = $insideRoot;

    return array_values(array_unique($candidates));
}

function cts_db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $lastError = null;

    foreach (cts_get_database_path_candidates() as $candidatePath) {
        try {
            $directory = dirname($candidatePath);
            if (!is_dir($directory) && !@mkdir($directory, 0755, true) && !is_dir($directory)) {
                throw new RuntimeException('Unable to create database directory.');
            }

            $connection = new PDO('sqlite:' . $candidatePath);
            $connection->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $connection->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            $connection->exec('PRAGMA foreign_keys = ON');

            cts_create_schema($connection);
            cts_bootstrap_admin_account($connection);

            $pdo = $connection;
            return $pdo;
        } catch (Throwable $throwable) {
            $lastError = $throwable;
        }
    }

    $message = $lastError ? $lastError->getMessage() : 'Unknown database error';
    throw new RuntimeException('Unable to open SQLite database: ' . $message);
}

function cts_create_schema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            last_login_at TEXT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS physicians (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            physician_id TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL UNIQUE,
            full_name TEXT NOT NULL,
            credentials TEXT DEFAULT \'\',
            password_hash TEXT NOT NULL,
            must_change_password INTEGER NOT NULL DEFAULT 1,
            is_active INTEGER NOT NULL DEFAULT 1,
            last_login_at TEXT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS forum_threads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trial_id TEXT NOT NULL,
            disease_group TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            author_physician_id INTEGER NOT NULL,
            reply_count INTEGER NOT NULL DEFAULT 0,
            locked_at TEXT NULL,
            locked_by_admin_id INTEGER NULL,
            deleted_at TEXT NULL,
            deleted_by_role TEXT NULL,
            deleted_by_id INTEGER NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            edited_at TEXT NULL,
            FOREIGN KEY (author_physician_id) REFERENCES physicians(id),
            FOREIGN KEY (locked_by_admin_id) REFERENCES admins(id)
        )'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS forum_replies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id INTEGER NOT NULL,
            body TEXT NOT NULL,
            author_physician_id INTEGER NOT NULL,
            deleted_at TEXT NULL,
            deleted_by_role TEXT NULL,
            deleted_by_id INTEGER NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            edited_at TEXT NULL,
            FOREIGN KEY (thread_id) REFERENCES forum_threads(id),
            FOREIGN KEY (author_physician_id) REFERENCES physicians(id)
        )'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            ip_address TEXT NOT NULL,
            failure_count INTEGER NOT NULL DEFAULT 0,
            last_attempt_at TEXT NULL,
            locked_until TEXT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (username, ip_address)
        )'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_role TEXT NOT NULL,
            actor_id INTEGER NULL,
            action TEXT NOT NULL,
            target_type TEXT NULL,
            target_id TEXT NULL,
            metadata_json TEXT NULL,
            created_at TEXT NOT NULL
        )'
    );

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_threads_trial_deleted ON forum_threads (trial_id, deleted_at, created_at DESC)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_replies_thread_deleted ON forum_replies (thread_id, deleted_at, created_at ASC)');
}

function cts_load_legacy_admin_config(): array
{
    $configFile = CTS_CONFIG_ROOT . '/admin_config.json';
    if (!file_exists($configFile)) {
        return [
            'username' => CTS_DEFAULT_ADMIN_USERNAME,
            'password' => CTS_DEFAULT_ADMIN_PASSWORD
        ];
    }

    $decoded = json_decode((string)file_get_contents($configFile), true);
    if (!is_array($decoded)) {
        return [
            'username' => CTS_DEFAULT_ADMIN_USERNAME,
            'password' => CTS_DEFAULT_ADMIN_PASSWORD
        ];
    }

    $credentials = isset($decoded['admin_credentials']) && is_array($decoded['admin_credentials'])
        ? $decoded['admin_credentials']
        : [];

    $username = trim((string)($credentials['username'] ?? CTS_DEFAULT_ADMIN_USERNAME));
    $password = (string)($credentials['password'] ?? CTS_DEFAULT_ADMIN_PASSWORD);

    return [
        'username' => $username !== '' ? $username : CTS_DEFAULT_ADMIN_USERNAME,
        'password' => $password !== '' ? $password : CTS_DEFAULT_ADMIN_PASSWORD
    ];
}

function cts_sanitize_legacy_admin_config(string $username): void
{
    $configFile = CTS_CONFIG_ROOT . '/admin_config.json';
    $backupPath = $configFile . '.legacy.backup.' . gmdate('Y-m-d-H-i-s');

    if (file_exists($configFile)) {
        @copy($configFile, $backupPath);
    }

    if (!is_dir(CTS_CONFIG_ROOT) && !@mkdir(CTS_CONFIG_ROOT, 0755, true) && !is_dir(CTS_CONFIG_ROOT)) {
        return;
    }

    $sanitized = [
        'migration' => [
            'legacy_admin_imported' => true,
            'imported_username' => $username,
            'migrated_at' => cts_now()
        ],
        'security' => [
            'password_min_length' => 12,
            'require_special_chars' => true
        ]
    ];

    @file_put_contents(
        $configFile,
        json_encode($sanitized, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
}

function cts_bootstrap_admin_account(PDO $pdo): void
{
    $count = (int)$pdo->query('SELECT COUNT(*) FROM admins')->fetchColumn();
    if ($count > 0) {
        return;
    }

    $legacyCredentials = cts_load_legacy_admin_config();
    $now = cts_now();

    $statement = $pdo->prepare(
        'INSERT INTO admins (username, password_hash, is_active, created_at, updated_at)
         VALUES (:username, :password_hash, 1, :created_at, :updated_at)'
    );

    $statement->execute([
        ':username' => $legacyCredentials['username'],
        ':password_hash' => password_hash($legacyCredentials['password'], PASSWORD_DEFAULT),
        ':created_at' => $now,
        ':updated_at' => $now
    ]);

    cts_sanitize_legacy_admin_config($legacyCredentials['username']);
}

function cts_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $secureCookie = (
        (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ||
        ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443)
    );

    session_name(CTS_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $secureCookie,
        'httponly' => true,
        'samesite' => 'Strict'
    ]);

    session_start();

    $lastActivity = (int)($_SESSION['last_activity_at'] ?? 0);
    if ($lastActivity > 0 && (time() - $lastActivity) > CTS_SESSION_IDLE_TIMEOUT) {
        cts_destroy_session();
        session_start();
    }

    $_SESSION['last_activity_at'] = time();

    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
}

function cts_destroy_session(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        $_SESSION = [];
        return;
    }

    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', (bool)($params['secure'] ?? false), (bool)($params['httponly'] ?? true));
    }

    session_destroy();
}

function cts_issue_session(string $role, int $userId): void
{
    cts_start_session();
    session_regenerate_id(true);

    $_SESSION['auth'] = [
        'role' => $role,
        'user_id' => $userId
    ];
    $_SESSION['last_activity_at'] = time();
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

function cts_get_session_actor(PDO $pdo): ?array
{
    cts_start_session();

    $auth = isset($_SESSION['auth']) && is_array($_SESSION['auth']) ? $_SESSION['auth'] : null;
    if (!$auth) {
        return null;
    }

    $role = (string)($auth['role'] ?? '');
    $userId = (int)($auth['user_id'] ?? 0);
    if ($role === '' || $userId <= 0) {
        return null;
    }

    if ($role === 'admin') {
        $statement = $pdo->prepare('SELECT id, username, is_active, last_login_at FROM admins WHERE id = :id LIMIT 1');
    } elseif ($role === 'physician') {
        $statement = $pdo->prepare(
            'SELECT id, physician_id, username, full_name, credentials, must_change_password, is_active, last_login_at
             FROM physicians
             WHERE id = :id
             LIMIT 1'
        );
    } else {
        cts_destroy_session();
        return null;
    }

    $statement->execute([':id' => $userId]);
    $actor = $statement->fetch();

    if (!$actor || (int)($actor['is_active'] ?? 0) !== 1) {
        cts_destroy_session();
        return null;
    }

    return [
        'role' => $role,
        'record' => $actor,
        'csrf_token' => (string)($_SESSION['csrf_token'] ?? '')
    ];
}

function cts_format_actor_for_response(array $actor): array
{
    $record = $actor['record'];

    if (($actor['role'] ?? '') === 'admin') {
        return [
            'role' => 'admin',
            'username' => $record['username'],
            'lastLoginAt' => $record['last_login_at']
        ];
    }

    return [
        'role' => 'physician',
        'physicianId' => $record['physician_id'],
        'username' => $record['username'],
        'fullName' => $record['full_name'],
        'credentials' => $record['credentials'],
        'mustChangePassword' => (bool)($record['must_change_password'] ?? false),
        'lastLoginAt' => $record['last_login_at']
    ];
}

function cts_require_role(PDO $pdo, string $role): array
{
    $actor = cts_get_session_actor($pdo);
    if (!$actor) {
        cts_json_response([
            'success' => false,
            'message' => 'Authentication required.'
        ], 401);
    }

    if (($actor['role'] ?? '') !== $role) {
        cts_json_response([
            'success' => false,
            'message' => 'You do not have permission to perform this action.'
        ], 403);
    }

    return $actor;
}

function cts_require_authenticated(PDO $pdo): array
{
    $actor = cts_get_session_actor($pdo);
    if (!$actor) {
        cts_json_response([
            'success' => false,
            'message' => 'Authentication required.'
        ], 401);
    }

    return $actor;
}

function cts_require_csrf(): void
{
    cts_start_session();
    $sessionToken = (string)($_SESSION['csrf_token'] ?? '');
    $providedToken = trim((string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''));

    if ($providedToken === '') {
        $payload = cts_read_json_input();
        $providedToken = trim((string)($payload['csrf_token'] ?? ''));
    }

    if ($sessionToken === '' || $providedToken === '' || !hash_equals($sessionToken, $providedToken)) {
        cts_json_response([
            'success' => false,
            'message' => 'Invalid CSRF token.'
        ], 403);
    }
}

function cts_password_validation_error(string $password): ?string
{
    if (strlen($password) < 12) {
        return 'Password must be at least 12 characters long.';
    }

    if (!preg_match('/[A-Z]/', $password)) {
        return 'Password must contain at least one uppercase letter.';
    }

    if (!preg_match('/[a-z]/', $password)) {
        return 'Password must contain at least one lowercase letter.';
    }

    if (!preg_match('/[0-9]/', $password)) {
        return 'Password must contain at least one number.';
    }

    if (!preg_match('/[^A-Za-z0-9]/', $password)) {
        return 'Password must contain at least one symbol.';
    }

    return null;
}

function cts_get_login_attempt(PDO $pdo, string $username, string $ipAddress): ?array
{
    $statement = $pdo->prepare(
        'SELECT id, failure_count, locked_until
         FROM login_attempts
         WHERE username = :username AND ip_address = :ip_address
         LIMIT 1'
    );
    $statement->execute([
        ':username' => $username,
        ':ip_address' => $ipAddress
    ]);

    $attempt = $statement->fetch();
    return $attempt ?: null;
}

function cts_require_login_not_locked(PDO $pdo, string $username, string $ipAddress): void
{
    $attempt = cts_get_login_attempt($pdo, $username, $ipAddress);
    if (!$attempt) {
        return;
    }

    $lockedUntil = trim((string)($attempt['locked_until'] ?? ''));
    if ($lockedUntil !== '' && strtotime($lockedUntil) > time()) {
        cts_json_response([
            'success' => false,
            'message' => 'Too many failed login attempts. Please try again later.'
        ], 429);
    }
}

function cts_record_failed_login(PDO $pdo, string $username, string $ipAddress): void
{
    $attempt = cts_get_login_attempt($pdo, $username, $ipAddress);
    $now = cts_now();

    if (!$attempt) {
        $statement = $pdo->prepare(
            'INSERT INTO login_attempts (username, ip_address, failure_count, last_attempt_at, locked_until, created_at, updated_at)
             VALUES (:username, :ip_address, 1, :last_attempt_at, NULL, :created_at, :updated_at)'
        );
        $statement->execute([
            ':username' => $username,
            ':ip_address' => $ipAddress,
            ':last_attempt_at' => $now,
            ':created_at' => $now,
            ':updated_at' => $now
        ]);
        return;
    }

    $failureCount = (int)$attempt['failure_count'] + 1;
    $lockedUntil = null;

    if ($failureCount >= CTS_LOGIN_LOCK_THRESHOLD) {
        $lockedUntil = gmdate('c', time() + (CTS_LOGIN_LOCK_MINUTES * 60));
    }

    $statement = $pdo->prepare(
        'UPDATE login_attempts
         SET failure_count = :failure_count,
             last_attempt_at = :last_attempt_at,
             locked_until = :locked_until,
             updated_at = :updated_at
         WHERE id = :id'
    );
    $statement->execute([
        ':failure_count' => $failureCount,
        ':last_attempt_at' => $now,
        ':locked_until' => $lockedUntil,
        ':updated_at' => $now,
        ':id' => (int)$attempt['id']
    ]);
}

function cts_clear_failed_login(PDO $pdo, string $username, string $ipAddress): void
{
    $statement = $pdo->prepare(
        'DELETE FROM login_attempts WHERE username = :username AND ip_address = :ip_address'
    );
    $statement->execute([
        ':username' => $username,
        ':ip_address' => $ipAddress
    ]);
}

function cts_audit_log(PDO $pdo, string $action, ?string $targetType = null, ?string $targetId = null, array $metadata = [], ?array $actor = null): void
{
    $actorRole = 'system';
    $actorId = null;

    if ($actor) {
        $actorRole = (string)($actor['role'] ?? 'system');
        $actorId = (int)(($actor['record']['id'] ?? 0) ?: 0);
        if ($actorId <= 0) {
            $actorId = null;
        }
    }

    $statement = $pdo->prepare(
        'INSERT INTO audit_log (actor_role, actor_id, action, target_type, target_id, metadata_json, created_at)
         VALUES (:actor_role, :actor_id, :action, :target_type, :target_id, :metadata_json, :created_at)'
    );
    $statement->execute([
        ':actor_role' => $actorRole,
        ':actor_id' => $actorId,
        ':action' => $action,
        ':target_type' => $targetType,
        ':target_id' => $targetId,
        ':metadata_json' => !empty($metadata) ? json_encode($metadata, JSON_UNESCAPED_UNICODE) : null,
        ':created_at' => cts_now()
    ]);
}

function cts_normalize_status_value($status): ?string
{
    $normalized = strtolower(trim((string)$status));
    $aliases = [
        'recruiting' => 'recruiting',
        'ongoing' => 'recruiting',
        'active_not_recruiting' => 'active_not_recruiting',
        'active, not recruiting' => 'active_not_recruiting',
        'upcoming' => 'active_not_recruiting',
        'completed' => 'completed',
        'past' => 'completed',
        'not_specified' => 'not_specified',
        'not specified' => 'not_specified',
        'unspecified' => 'not_specified',
        'unknown' => 'not_specified'
    ];

    return $aliases[$normalized] ?? null;
}

function cts_normalize_cancer_type_value($cancerType): ?string
{
    $normalized = strtolower(trim((string)$cancerType));
    $aliases = [
        'prostate' => 'Prostate',
        'kidney' => 'Kidney',
        'renal' => 'Kidney',
        'kidney/rcc' => 'Kidney',
        'bladder' => 'Bladder',
        'urothelial' => 'Bladder',
        'bladder/urothelial' => 'Bladder',
        'testicular' => 'Testicular',
        'testis' => 'Testicular',
        'testicular/gct' => 'Testicular',
        'adrenal' => 'Adrenal',
        'other' => 'Others',
        'others' => 'Others'
    ];

    return $aliases[$normalized] ?? null;
}

function cts_infer_cancer_type_from_text($text): ?string
{
    $haystack = strtolower(trim((string)$text));
    if ($haystack === '') {
        return null;
    }

    if (preg_match('/\b(prostate|prostatic|mcrpc|castration-resistant prostate)\b/', $haystack)) {
        return 'Prostate';
    }

    if (preg_match('/\b(kidney|renal|rcc|renal cell carcinoma)\b/', $haystack)) {
        return 'Kidney';
    }

    if (preg_match('/\b(bladder|urothelial|nmibc|mibc)\b/', $haystack)) {
        return 'Bladder';
    }

    if (preg_match('/\b(testicular|testis|germ cell|seminoma)\b/', $haystack)) {
        return 'Testicular';
    }

    if (preg_match('/\b(adrenal|adrenocortical|pheochromocytoma|paraganglioma)\b/', $haystack)) {
        return 'Adrenal';
    }

    return null;
}

function cts_resolve_trial_cancer_type(array $trial): ?string
{
    $explicitType = cts_normalize_cancer_type_value($trial['type'] ?? $trial['cancerType'] ?? '');
    if ($explicitType !== null) {
        return $explicitType;
    }

    $eligibilityText = $trial['eligibilityCriteria'] ?? [];
    if (is_array($eligibilityText)) {
        $eligibilityText = implode(' ', array_map(static function ($item): string {
            return trim((string)$item);
        }, $eligibilityText));
    }

    return cts_infer_cancer_type_from_text(implode(' ', array_filter([
        trim((string)($trial['title'] ?? '')),
        trim((string)($trial['description'] ?? '')),
        trim((string)($trial['qualification'] ?? '')),
        trim((string)$eligibilityText)
    ])));
}

function cts_normalize_list_field($value): array
{
    if (is_array($value)) {
        $result = [];
        foreach ($value as $item) {
            $trimmed = trim((string)$item);
            if ($trimmed !== '') {
                $result[] = $trimmed;
            }
        }
        return $result;
    }

    $trimmed = trim((string)$value);
    return $trimmed === '' ? [] : [$trimmed];
}

function cts_normalize_sites_field($value): array
{
    if (!is_array($value)) {
        return [];
    }

    $normalized = [];
    foreach ($value as $site) {
        if (!is_array($site)) {
            continue;
        }

        $siteRecord = [
            'siteId' => trim((string)($site['siteId'] ?? '')),
            'institution' => trim((string)($site['institution'] ?? '')),
            'city' => trim((string)($site['city'] ?? '')),
            'state' => trim((string)($site['state'] ?? '')),
            'address' => trim((string)($site['address'] ?? '')),
            'piName' => trim((string)($site['piName'] ?? '')),
            'email' => trim((string)($site['email'] ?? '')),
            'phone' => trim((string)($site['phone'] ?? '')),
            'affiliation' => trim((string)($site['affiliation'] ?? '')),
            'locationStatus' => trim((string)($site['locationStatus'] ?? $site['status'] ?? 'unknown')),
            'statusSource' => trim((string)($site['statusSource'] ?? 'not_available')),
            'sourceVerifiedDate' => isset($site['sourceVerifiedDate']) && $site['sourceVerifiedDate'] !== '' ? trim((string)$site['sourceVerifiedDate']) : null,
            'ingestedAt' => isset($site['ingestedAt']) && $site['ingestedAt'] !== '' ? trim((string)$site['ingestedAt']) : null,
            'manualStatus' => isset($site['manualStatus']) && $site['manualStatus'] !== '' ? trim((string)$site['manualStatus']) : null,
            'statusStale' => (bool)($site['statusStale'] ?? false)
        ];

        $hasContent = false;
        foreach ($siteRecord as $fieldValue) {
            if ($fieldValue !== '') {
                $hasContent = true;
                break;
            }
        }

        if ($hasContent) {
            $normalized[] = $siteRecord;
        }
    }

    return $normalized;
}

function cts_normalize_clinical_axes_field($value): array
{
    if (!is_array($value)) {
        return [];
    }

    $normalized = [];
    foreach ($value as $key => $axisValue) {
        $normalizedKey = trim((string)$key);
        $normalizedValue = trim((string)$axisValue);
        if ($normalizedKey !== '' && $normalizedValue !== '') {
            $normalized[$normalizedKey] = $normalizedValue;
        }
    }

    return $normalized;
}

function cts_normalize_source_tags_field($value): array
{
    if (!is_array($value)) {
        return [];
    }

    $normalized = [];
    foreach ($value as $key => $tagValue) {
        $normalizedKey = trim((string)$key);
        if ($normalizedKey === '') {
            continue;
        }

        if (is_array($tagValue)) {
            $nested = [];
            foreach ($tagValue as $nestedKey => $nestedValue) {
                $normalizedNestedKey = trim((string)$nestedKey);
                $normalizedNestedValue = trim((string)$nestedValue);
                if ($normalizedNestedKey !== '' && $normalizedNestedValue !== '') {
                    $nested[$normalizedNestedKey] = $normalizedNestedValue;
                }
            }
            if (!empty($nested)) {
                $normalized[$normalizedKey] = $nested;
            }
            continue;
        }

        $normalizedValue = trim((string)$tagValue);
        if ($normalizedValue !== '') {
            $normalized[$normalizedKey] = $normalizedValue;
        }
    }

    return $normalized;
}

function cts_normalize_catalog_metadata($metadata): array
{
    if (!is_array($metadata)) {
        return [];
    }

    return [
        'exportType' => trim((string)($metadata['exportType'] ?? '')),
        'exportedAt' => trim((string)($metadata['exportedAt'] ?? '')),
        'lastSyncAt' => trim((string)($metadata['lastSyncAt'] ?? '')),
        'pipelineVersion' => trim((string)($metadata['pipelineVersion'] ?? '')),
        'sourceRun' => trim((string)($metadata['sourceRun'] ?? '')),
        'sourceRunDir' => trim((string)($metadata['sourceRunDir'] ?? '')),
        'trialCount' => (int)($metadata['trialCount'] ?? 0),
        'institutionCount' => (int)($metadata['institutionCount'] ?? 0),
        'schemaVersion' => trim((string)($metadata['schemaVersion'] ?? '')),
        'schemaMigratedAt' => trim((string)($metadata['schemaMigratedAt'] ?? '')),
        'schemaMigration' => trim((string)($metadata['schemaMigration'] ?? '')),
        'criterionCount' => (int)($metadata['criterionCount'] ?? 0),
        'cohortCount' => (int)($metadata['cohortCount'] ?? 0),
        'rawPatientNarrativePersisted' => (bool)($metadata['rawPatientNarrativePersisted'] ?? false)
    ];
}

function cts_normalize_trial_shape($trial): array
{
    if (!is_array($trial)) {
        return [];
    }

    $location = isset($trial['location']) && is_array($trial['location']) ? $trial['location'] : [];
    $normalizedStatus = cts_normalize_status_value($trial['status'] ?? '');
    $normalizedCancerType = cts_resolve_trial_cancer_type($trial);
    $sites = cts_normalize_sites_field($trial['sites'] ?? []);
    $availableInstitutions = cts_normalize_list_field($trial['availableInstitutions'] ?? []);
    $cancerTypes = cts_normalize_list_field($trial['cancerTypes'] ?? []);
    $diseaseSettingAll = cts_normalize_list_field($trial['diseaseSettingAll'] ?? []);
    $diseaseSettingAllIds = cts_normalize_list_field($trial['diseaseSettingAllIds'] ?? []);
    $conditions = cts_normalize_list_field($trial['conditions'] ?? []);
    $interventions = cts_normalize_list_field($trial['interventions'] ?? []);
    $primaryOutcomes = cts_normalize_list_field($trial['primaryOutcomes'] ?? []);
    $secondaryOutcomes = cts_normalize_list_field($trial['secondaryOutcomes'] ?? []);
    $classificationEvidence = cts_normalize_list_field($trial['classificationEvidence'] ?? []);
    $clinicalAxes = cts_normalize_clinical_axes_field($trial['clinicalAxes'] ?? []);
    $sourceTags = cts_normalize_source_tags_field($trial['sourceTags'] ?? []);

    if (empty($availableInstitutions) && !empty($sites)) {
        foreach ($sites as $site) {
            if (($site['institution'] ?? '') !== '') {
                $availableInstitutions[] = $site['institution'];
            }
        }
        $availableInstitutions = array_values(array_unique($availableInstitutions));
    }

    if (empty($cancerTypes) && $normalizedCancerType !== null) {
        $cancerTypes[] = $normalizedCancerType;
    } else {
        $normalizedCancerTypes = [];
        foreach ($cancerTypes as $cancerType) {
            $mappedCancerType = cts_normalize_cancer_type_value($cancerType);
            if ($mappedCancerType !== null && !in_array($mappedCancerType, $normalizedCancerTypes, true)) {
                $normalizedCancerTypes[] = $mappedCancerType;
            }
        }
        $cancerTypes = $normalizedCancerTypes;
    }

    if (empty($location) && !empty($sites)) {
        $primarySite = $sites[0];
        $location = [
            'hospital' => $primarySite['institution'] ?? '',
            'city' => $primarySite['city'] ?? '',
            'state' => $primarySite['state'] ?? '',
            'zipCode' => '',
            'address' => $primarySite['address'] ?? ''
        ];
    }

    return [
        'id' => trim((string)($trial['id'] ?? '')),
        'schemaVersion' => trim((string)($trial['schemaVersion'] ?? '')),
        'registry' => trim((string)($trial['registry'] ?? '')),
        'registryVersion' => trim((string)($trial['registryVersion'] ?? '')),
        'retrievedAt' => trim((string)($trial['retrievedAt'] ?? '')),
        'rawRecordHash' => trim((string)($trial['rawRecordHash'] ?? '')),
        'sourceContentHash' => trim((string)($trial['sourceContentHash'] ?? '')),
        'nctId' => trim((string)($trial['nctId'] ?? '')),
        'title' => trim((string)($trial['title'] ?? '')),
        'status' => $normalizedStatus ?? 'not_specified',
        'description' => trim((string)($trial['description'] ?? '')),
        'qualification' => trim((string)($trial['qualification'] ?? '')),
        'location' => [
            'hospital' => trim((string)($location['hospital'] ?? '')),
            'city' => trim((string)($location['city'] ?? '')),
            'state' => trim((string)($location['state'] ?? '')),
            'zipCode' => trim((string)($location['zipCode'] ?? '')),
            'address' => trim((string)($location['address'] ?? ''))
        ],
        'contactEmail' => trim((string)($trial['contactEmail'] ?? '')),
        'startDate' => trim((string)($trial['startDate'] ?? '')),
        'endDate' => trim((string)($trial['endDate'] ?? '')),
        'estimatedDuration' => trim((string)($trial['estimatedDuration'] ?? '')),
        'studyType' => trim((string)($trial['studyType'] ?? '')),
        'phase' => trim((string)($trial['phase'] ?? '')),
        'phaseRaw' => trim((string)($trial['phaseRaw'] ?? '')),
        'cancerType' => $normalizedCancerType ?? '',
        'cancerTypes' => $cancerTypes,
        'sponsor' => trim((string)($trial['sponsor'] ?? '')),
        'lastWebsiteUpdate' => trim((string)($trial['lastWebsiteUpdate'] ?? '')),
        'instituteId' => trim((string)($trial['instituteId'] ?? '')),
        'piName' => trim((string)($trial['piName'] ?? '')),
        'primaryObjective' => trim((string)($trial['primaryObjective'] ?? '')),
        'secondaryObjectives' => cts_normalize_list_field($trial['secondaryObjectives'] ?? []),
        'eligibilityCriteria' => cts_normalize_list_field($trial['eligibilityCriteria'] ?? []),
        'lastUpdated' => trim((string)($trial['lastUpdated'] ?? '')),
        'diseaseSettingPrimary' => trim((string)($trial['diseaseSettingPrimary'] ?? '')),
        'diseaseSettingPrimaryId' => trim((string)($trial['diseaseSettingPrimaryId'] ?? '')),
        'diseaseSettingAll' => $diseaseSettingAll,
        'diseaseSettingAllIds' => $diseaseSettingAllIds,
        'classificationConfidence' => trim((string)($trial['classificationConfidence'] ?? '')),
        'classificationEvidenceStrength' => trim((string)($trial['classificationEvidenceStrength'] ?? $trial['classificationConfidence'] ?? '')),
        'classificationIsProbability' => (bool)($trial['classificationIsProbability'] ?? false),
        'classificationMethod' => trim((string)($trial['classificationMethod'] ?? '')),
        'classificationEvidence' => $classificationEvidence,
        'classificationFieldEvidence' => isset($trial['classificationFieldEvidence']) && is_array($trial['classificationFieldEvidence']) ? $trial['classificationFieldEvidence'] : [],
        'treatmentModality' => trim((string)($trial['treatmentModality'] ?? '')),
        'delivery' => trim((string)($trial['delivery'] ?? '')),
        'clinicalAxes' => $clinicalAxes,
        'sourceTags' => $sourceTags,
        'criteria' => isset($trial['criteria']) && is_array($trial['criteria']) ? $trial['criteria'] : [],
        'cohorts' => isset($trial['cohorts']) && is_array($trial['cohorts']) ? $trial['cohorts'] : [],
        'dataQuality' => isset($trial['dataQuality']) && is_array($trial['dataQuality']) ? $trial['dataQuality'] : [],
        'provenance' => isset($trial['provenance']) && is_array($trial['provenance']) ? $trial['provenance'] : [],
        'nccnTaxonomyVersion' => trim((string)($trial['nccnTaxonomyVersion'] ?? '')),
        'ctGovUrl' => trim((string)($trial['ctGovUrl'] ?? '')),
        'conditions' => $conditions,
        'interventions' => $interventions,
        'availableInstitutions' => $availableInstitutions,
        'siteCount' => (int)($trial['siteCount'] ?? count($sites)),
        'sites' => $sites,
        'inclusionCriteria' => trim((string)($trial['inclusionCriteria'] ?? '')),
        'exclusionCriteria' => trim((string)($trial['exclusionCriteria'] ?? '')),
        'primaryOutcomes' => $primaryOutcomes,
        'secondaryOutcomes' => $secondaryOutcomes,
        'studyFirstPosted' => trim((string)($trial['studyFirstPosted'] ?? '')),
        'lastUpdatePosted' => trim((string)($trial['lastUpdatePosted'] ?? '')),
        'lastSyncAt' => trim((string)($trial['lastSyncAt'] ?? '')),
        'pipelineVersion' => trim((string)($trial['pipelineVersion'] ?? '')),
        'sourceRun' => trim((string)($trial['sourceRun'] ?? '')),
        'sourceRunDir' => trim((string)($trial['sourceRunDir'] ?? ''))
    ];
}

function cts_load_trials_payload(): array
{
    $dataFile = CTS_DATA_ROOT . '/trials.json';
    if (!file_exists($dataFile)) {
        return [
            'metadata' => [],
            'trials' => []
        ];
    }

    $decoded = json_decode((string)file_get_contents($dataFile), true);
    if (!is_array($decoded)) {
        return [
            'metadata' => [],
            'trials' => []
        ];
    }

    $isList = empty($decoded)
        || (function_exists('array_is_list') ? array_is_list($decoded) : array_keys($decoded) === range(0, count($decoded) - 1));
    $trials = $isList
        ? $decoded
        : (isset($decoded['trials']) && is_array($decoded['trials']) ? $decoded['trials'] : []);
    $normalizedTrials = [];

    foreach ($trials as $trial) {
        $normalizedTrials[] = cts_normalize_trial_shape($trial);
    }

    return [
        'metadata' => $isList ? [] : cts_normalize_catalog_metadata($decoded['metadata'] ?? []),
        'trials' => $normalizedTrials
    ];
}

function cts_load_trials_catalog(): array
{
    $payload = cts_load_trials_payload();
    return $payload['trials'] ?? [];
}

function cts_load_trials_metadata(): array
{
    $payload = cts_load_trials_payload();
    return $payload['metadata'] ?? [];
}

function cts_find_trial(array $trials, string $trialId): ?array
{
    foreach ($trials as $trial) {
        if (($trial['id'] ?? '') === $trialId) {
            return $trial;
        }
    }

    return null;
}

function cts_validate_trial_payload($trial): ?string
{
    if (!is_array($trial)) {
        return 'Invalid trial payload.';
    }

    $email = trim((string)($trial['contactEmail'] ?? ''));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return 'Invalid email format.';
    }

    $status = trim((string)($trial['status'] ?? ''));
    $validStatuses = ['recruiting', 'active_not_recruiting', 'completed', 'not_specified'];
    if ($status !== '' && !in_array($status, $validStatuses, true)) {
        return 'Invalid status value.';
    }

    $cancerType = trim((string)($trial['cancerType'] ?? ''));
    $validCancerTypes = ['Prostate', 'Kidney', 'Bladder', 'Testicular', 'Adrenal', 'Others'];
    if ($cancerType !== '' && !in_array($cancerType, $validCancerTypes, true)) {
        return 'Invalid cancer type.';
    }

    $cancerTypes = $trial['cancerTypes'] ?? [];
    if (is_array($cancerTypes)) {
        foreach ($cancerTypes as $item) {
            $normalizedCancerType = cts_normalize_cancer_type_value($item);
            if ($normalizedCancerType === null) {
                return 'Invalid cancer type list.';
            }
        }
    }

    $dateFields = [
        'startDate',
        'endDate',
        'lastWebsiteUpdate',
        'studyFirstPosted',
        'lastUpdatePosted',
        'lastSyncAt',
        'lastUpdated'
    ];
    foreach ($dateFields as $dateField) {
        $value = trim((string)($trial[$dateField] ?? ''));
        if ($value !== '' && strtotime($value) === false) {
            return 'Invalid date format for ' . $dateField . '.';
        }
    }

    $startDate = trim((string)($trial['startDate'] ?? ''));
    $endDate = trim((string)($trial['endDate'] ?? ''));
    if ($startDate !== '' && $endDate !== '' && strtotime($endDate) <= strtotime($startDate)) {
        return 'End date must be after start date.';
    }

    return null;
}

function cts_write_trials_catalog(array $trials, array $metadata = []): void
{
    if (!is_dir(CTS_DATA_ROOT) && !@mkdir(CTS_DATA_ROOT, 0755, true) && !is_dir(CTS_DATA_ROOT)) {
        throw new RuntimeException('Unable to create data directory.');
    }

    $dataFile = CTS_DATA_ROOT . '/trials.json';
    if (file_exists($dataFile)) {
        @copy($dataFile, $dataFile . '.backup.' . gmdate('Y-m-d-H-i-s'));
    }

    $payload = [
        'metadata' => cts_normalize_catalog_metadata($metadata),
        'trials' => array_values($trials)
    ];

    $result = file_put_contents(
        $dataFile,
        json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );

    if ($result === false) {
        throw new RuntimeException('Unable to save trials catalog.');
    }
}

function cts_find_trial_index_by_id(array $trials, string $trialId): int
{
    foreach ($trials as $index => $trial) {
        if (($trial['id'] ?? '') === $trialId) {
            return (int)$index;
        }
    }

    return -1;
}

function cts_find_trial_index_by_nct_id(array $trials, string $nctId): int
{
    $needle = strtolower(trim($nctId));
    if ($needle === '') {
        return -1;
    }

    foreach ($trials as $index => $trial) {
        $existing = strtolower(trim((string)($trial['nctId'] ?? '')));
        if ($existing !== '' && $existing === $needle) {
            return (int)$index;
        }
    }

    return -1;
}

function cts_delete_forum_content_for_missing_trials(PDO $pdo, array $activeTrialIds): array
{
    $normalizedIds = [];
    foreach ($activeTrialIds as $trialId) {
        $candidate = trim((string)$trialId);
        if ($candidate !== '') {
            $normalizedIds[] = $candidate;
        }
    }
    $normalizedIds = array_values(array_unique($normalizedIds));

    if (empty($normalizedIds)) {
        $deletedReplies = (int)$pdo->query('SELECT COUNT(*) FROM forum_replies')->fetchColumn();
        $deletedThreads = (int)$pdo->query('SELECT COUNT(*) FROM forum_threads')->fetchColumn();
        $pdo->exec('DELETE FROM forum_replies');
        $pdo->exec('DELETE FROM forum_threads');

        return [
            'deletedReplies' => $deletedReplies,
            'deletedThreads' => $deletedThreads
        ];
    }

    $placeholders = [];
    $params = [];
    foreach ($normalizedIds as $index => $trialId) {
        $placeholder = ':trial_id_' . $index;
        $placeholders[] = $placeholder;
        $params[$placeholder] = $trialId;
    }

    $notInClause = implode(', ', $placeholders);

    $countThreadsStatement = $pdo->prepare(
        'SELECT COUNT(*) FROM forum_threads WHERE trial_id NOT IN (' . $notInClause . ')'
    );
    $countThreadsStatement->execute($params);
    $deletedThreads = (int)$countThreadsStatement->fetchColumn();

    if ($deletedThreads === 0) {
        return [
            'deletedReplies' => 0,
            'deletedThreads' => 0
        ];
    }

    $countRepliesStatement = $pdo->prepare(
        'SELECT COUNT(*)
         FROM forum_replies
         WHERE thread_id IN (
            SELECT id FROM forum_threads WHERE trial_id NOT IN (' . $notInClause . ')
         )'
    );
    $countRepliesStatement->execute($params);
    $deletedReplies = (int)$countRepliesStatement->fetchColumn();

    $deleteRepliesStatement = $pdo->prepare(
        'DELETE FROM forum_replies
         WHERE thread_id IN (
            SELECT id FROM forum_threads WHERE trial_id NOT IN (' . $notInClause . ')
         )'
    );
    $deleteRepliesStatement->execute($params);

    $deleteThreadsStatement = $pdo->prepare(
        'DELETE FROM forum_threads WHERE trial_id NOT IN (' . $notInClause . ')'
    );
    $deleteThreadsStatement->execute($params);

    return [
        'deletedReplies' => $deletedReplies,
        'deletedThreads' => $deletedThreads
    ];
}

function cts_generate_unique_id(string $prefix = 'trial_'): string
{
    return uniqid($prefix, true);
}

function cts_refresh_thread_reply_count(PDO $pdo, int $threadId): void
{
    $countStatement = $pdo->prepare(
        'SELECT COUNT(*) FROM forum_replies WHERE thread_id = :thread_id AND deleted_at IS NULL'
    );
    $countStatement->execute([':thread_id' => $threadId]);
    $replyCount = (int)$countStatement->fetchColumn();

    $updateStatement = $pdo->prepare(
        'UPDATE forum_threads SET reply_count = :reply_count, updated_at = :updated_at WHERE id = :id'
    );
    $updateStatement->execute([
        ':reply_count' => $replyCount,
        ':updated_at' => cts_now(),
        ':id' => $threadId
    ]);
}
