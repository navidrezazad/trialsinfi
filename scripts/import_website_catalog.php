<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/bootstrap.php';

function cli_error(string $message, int $exitCode = 1): void
{
    fwrite(STDERR, $message . PHP_EOL);
    exit($exitCode);
}

function cli_info(string $message): void
{
    fwrite(STDOUT, $message . PHP_EOL);
}

function cli_write_catalog_file(string $catalogPath, array $trials, array $metadata): void
{
    $directory = dirname($catalogPath);
    if (!is_dir($directory) && !@mkdir($directory, 0755, true) && !is_dir($directory)) {
        throw new RuntimeException('Unable to create output directory: ' . $directory);
    }

    if (file_exists($catalogPath)) {
        @copy($catalogPath, $catalogPath . '.backup.' . gmdate('Y-m-d-H-i-s'));
    }

    $payload = [
        'metadata' => cts_normalize_catalog_metadata($metadata),
        'trials' => array_values($trials)
    ];

    $result = file_put_contents(
        $catalogPath,
        json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );

    if ($result === false) {
        throw new RuntimeException('Unable to write catalog file.');
    }
}

$args = $argv;
array_shift($args);

if (count($args) < 1) {
    cli_error('Usage: php scripts/import_website_catalog.php <website_trials.json> [--catalog-path=/path/to/trials.json] [--skip-forum-cleanup]');
}

$inputPath = array_shift($args);
$catalogPath = CTS_DATA_ROOT . '/trials.json';
$skipForumCleanup = false;

foreach ($args as $arg) {
    if (str_starts_with($arg, '--catalog-path=')) {
        $catalogPath = substr($arg, strlen('--catalog-path='));
        continue;
    }

    if ($arg === '--skip-forum-cleanup') {
        $skipForumCleanup = true;
        continue;
    }

    cli_error('Unknown option: ' . $arg);
}

if (!is_file($inputPath)) {
    cli_error('Input file not found: ' . $inputPath);
}

$rawPayload = json_decode((string)file_get_contents($inputPath), true);
if (!is_array($rawPayload)) {
    cli_error('Input file does not contain valid JSON: ' . $inputPath);
}

$rawTrials = isset($rawPayload['trials']) && is_array($rawPayload['trials']) ? $rawPayload['trials'] : [];
if (empty($rawTrials)) {
    cli_error('Input file does not contain any trials.');
}

$rawMetadata = cts_normalize_catalog_metadata($rawPayload['metadata'] ?? []);
$existingPayload = cts_load_trials_payload();
$existingTrials = $existingPayload['trials'] ?? [];
$existingMetadata = $existingPayload['metadata'] ?? [];

$normalizedTrials = [];
$errors = [];

foreach ($rawTrials as $index => $trialPayload) {
    $rowNumber = $index + 1;
    if (!is_array($trialPayload)) {
        $errors[] = "Row {$rowNumber}: invalid trial payload.";
        continue;
    }

    $trial = cts_normalize_trial_shape($trialPayload);
    if (($trial['id'] ?? '') === '' && ($trial['nctId'] ?? '') !== '') {
        $trial['id'] = (string)$trial['nctId'];
    }
    if (($trial['lastUpdated'] ?? '') === '') {
        $trial['lastUpdated'] = cts_now();
    }
    if (($trial['lastWebsiteUpdate'] ?? '') === '') {
        $trial['lastWebsiteUpdate'] = substr((string)($trial['lastSyncAt'] ?? cts_now()), 0, 10);
    }

    $validationError = cts_validate_trial_payload($trial);
    if ($validationError !== null) {
        $errors[] = "Row {$rowNumber}: {$validationError}";
        continue;
    }

    $normalizedTrials[] = $trial;
}

if (!empty($errors)) {
    cli_error("Catalog import failed validation:\n- " . implode("\n- ", $errors));
}

$replacementIds = array_map(static function (array $trial): string {
    return (string)($trial['id'] ?? '');
}, $normalizedTrials);
$existingIds = array_map(static function (array $trial): string {
    return (string)($trial['id'] ?? '');
}, $existingTrials);

$preserved = count(array_intersect(
    array_values(array_filter($replacementIds)),
    array_values(array_filter($existingIds))
));
$created = count($normalizedTrials) - $preserved;
$removed = count(array_diff(
    array_values(array_filter($existingIds)),
    array_values(array_filter($replacementIds))
));

$effectiveMetadata = array_merge($existingMetadata, $rawMetadata, [
    'trialCount' => count($normalizedTrials),
    'institutionCount' => (int)($rawMetadata['institutionCount'] ?? 0),
    'lastSyncAt' => (string)($rawMetadata['lastSyncAt'] ?? cts_now())
]);

$defaultCatalogPath = realpath(dirname($catalogPath)) === realpath(CTS_DATA_ROOT)
    && basename($catalogPath) === 'trials.json';

if ($defaultCatalogPath && !$skipForumCleanup) {
    $pdo = cts_db();
    $catalogWritten = false;
    $deletedForumReplies = 0;
    $deletedForumThreads = 0;

    try {
        cts_write_trials_catalog($normalizedTrials, $effectiveMetadata);
        $catalogWritten = true;

        $pdo->beginTransaction();
        $forumCleanup = cts_delete_forum_content_for_missing_trials($pdo, $replacementIds);
        $deletedForumReplies = (int)($forumCleanup['deletedReplies'] ?? 0);
        $deletedForumThreads = (int)($forumCleanup['deletedThreads'] ?? 0);

        cts_audit_log($pdo, 'website_catalog_imported', 'trial_catalog', 'trials.json', [
            'imported' => count($normalizedTrials),
            'created' => $created,
            'preserved' => $preserved,
            'removed' => $removed,
            'source_file' => $inputPath,
            'deleted_forum_threads' => $deletedForumThreads,
            'deleted_forum_replies' => $deletedForumReplies
        ]);
        $pdo->commit();
    } catch (Throwable $throwable) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        if ($catalogWritten) {
            cts_write_trials_catalog($existingTrials, $existingMetadata);
        }

        cli_error('Import failed: ' . $throwable->getMessage());
    }

    cli_info('Imported website catalog into data/trials.json');
    cli_info("Trials: " . count($normalizedTrials) . " | created: {$created} | preserved: {$preserved} | removed: {$removed}");
    cli_info("Forum cleanup: {$deletedForumThreads} threads, {$deletedForumReplies} replies");
    exit(0);
}

try {
    cli_write_catalog_file($catalogPath, $normalizedTrials, $effectiveMetadata);
} catch (Throwable $throwable) {
    cli_error('Import failed: ' . $throwable->getMessage());
}

cli_info('Imported website catalog into ' . $catalogPath);
cli_info("Trials: " . count($normalizedTrials) . " | created: {$created} | preserved: {$preserved} | removed: {$removed}");
