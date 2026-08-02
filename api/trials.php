<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

cts_init_api();

function cts_prepare_trial_for_save(array $trialPayload): array
{
    $trial = cts_normalize_trial_shape($trialPayload);
    if (($trial['id'] ?? '') === '') {
        $trial['id'] = cts_generate_unique_id('trial_');
    }

    if (($trial['lastUpdated'] ?? '') === '') {
        $trial['lastUpdated'] = cts_now();
    }

    return $trial;
}

/**
 * Stream the large public catalog one trial at a time. Encoding the complete
 * response into one string temporarily duplicates tens of megabytes and can
 * exhaust a standard 128 MB PHP worker after cohort criteria are normalized.
 */
function cts_stream_trials_catalog_response(array $trials, array $metadata): void
{
    http_response_code(200);
    echo '{"success":true,"trials":[';
    foreach ($trials as $index => $trial) {
        if ($index > 0) {
            echo ',';
        }
        $encodedTrial = json_encode($trial, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($encodedTrial === false) {
            throw new RuntimeException('Unable to encode trial catalog response.');
        }
        echo $encodedTrial;
    }
    $encodedMetadata = json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encodedMetadata === false) {
        throw new RuntimeException('Unable to encode trial catalog metadata.');
    }
    echo '],"metadata":' . $encodedMetadata . ',"count":' . count($trials) . '}';
    exit;
}

function cts_handle_bulk_replace(PDO $pdo, array $rows, array $actor): void
{
    if (empty($rows)) {
        cts_json_response([
            'success' => false,
            'message' => 'CSV import must include at least one trial row.'
        ], 400);
    }

    $existingPayload = cts_load_trials_payload();
    $existingTrials = $existingPayload['trials'] ?? [];
    $existingMetadata = $existingPayload['metadata'] ?? [];
    $replacementTrials = [];
    $errors = [];

    foreach ($rows as $index => $row) {
        $rowNumber = is_array($row) && isset($row['_rowNumber']) ? (int)$row['_rowNumber'] : $index + 2;

        if (!is_array($row)) {
            $errors[] = [
                'row' => $rowNumber,
                'message' => 'Invalid row payload.'
            ];
            continue;
        }

        unset($row['_rowNumber']);

        $trial = cts_prepare_trial_for_save($row);

        $matchByIdIndex = cts_find_trial_index_by_id($existingTrials, (string)($trial['id'] ?? ''));
        $matchByNctIndex = cts_find_trial_index_by_nct_id($existingTrials, (string)($trial['nctId'] ?? ''));
        if ($matchByIdIndex !== -1 && $matchByNctIndex !== -1 && $matchByIdIndex !== $matchByNctIndex) {
            $errors[] = [
                'row' => $rowNumber,
                'message' => 'Conflict: provided id and nctId reference different trials.'
            ];
            continue;
        }

        $matchedExistingTrial = null;
        $matchIndex = $matchByIdIndex !== -1 ? $matchByIdIndex : $matchByNctIndex;
        if ($matchIndex !== -1) {
            $matchedExistingTrial = $existingTrials[$matchIndex];
            $trial['id'] = (string)$matchedExistingTrial['id'];
        }

        $validationError = cts_validate_trial_payload($trial);
        if ($validationError !== null) {
            $errors[] = [
                'row' => $rowNumber,
                'message' => $validationError
            ];
            continue;
        }

        $replacementIndexById = cts_find_trial_index_by_id($replacementTrials, (string)($trial['id'] ?? ''));
        $replacementIndexByNct = cts_find_trial_index_by_nct_id($replacementTrials, (string)($trial['nctId'] ?? ''));
        if ($replacementIndexById !== -1 && $replacementIndexByNct !== -1 && $replacementIndexById !== $replacementIndexByNct) {
            $errors[] = [
                'row' => $rowNumber,
                'message' => 'Conflict: provided id and nctId reference different rows in the CSV.'
            ];
            continue;
        }

        $trial['lastUpdated'] = cts_now();

        $replacementIndex = $replacementIndexById !== -1 ? $replacementIndexById : $replacementIndexByNct;
        if ($replacementIndex !== -1) {
            $trial['id'] = (string)$replacementTrials[$replacementIndex]['id'];
            $replacementTrials[$replacementIndex] = array_merge($replacementTrials[$replacementIndex], $trial, [
                'lastUpdated' => cts_now()
            ]);
        } else {
            $replacementTrials[] = $trial;
        }
    }

    if (!empty($errors)) {
        cts_json_response([
            'success' => false,
            'message' => 'CSV import failed validation. No changes were applied.',
            'errorCount' => count($errors),
            'errors' => $errors
        ], 400);
    }

    $previousTrialIds = array_map(static function (array $trial): string {
        return (string)($trial['id'] ?? '');
    }, $existingTrials);
    $replacementTrialIds = array_map(static function (array $trial): string {
        return (string)($trial['id'] ?? '');
    }, $replacementTrials);

    $preserved = count(array_intersect(
        array_values(array_filter($replacementTrialIds)),
        array_values(array_filter($previousTrialIds))
    ));
    $created = count($replacementTrials) - $preserved;
    $removed = count(array_diff(
        array_values(array_filter($previousTrialIds)),
        array_values(array_filter($replacementTrialIds))
    ));

    $deletedForumReplies = 0;
    $deletedForumThreads = 0;
    $catalogWritten = false;

    try {
        cts_write_trials_catalog($replacementTrials, $existingMetadata);
        $catalogWritten = true;

        $pdo->beginTransaction();
        $forumCleanup = cts_delete_forum_content_for_missing_trials($pdo, $replacementTrialIds);
        $deletedForumReplies = (int)($forumCleanup['deletedReplies'] ?? 0);
        $deletedForumThreads = (int)($forumCleanup['deletedThreads'] ?? 0);

        cts_audit_log($pdo, 'trial_catalog_replaced', 'trial_catalog', 'trials.json', [
            'imported' => count($replacementTrials),
            'created' => $created,
            'preserved' => $preserved,
            'removed' => $removed,
            'deleted_forum_threads' => $deletedForumThreads,
            'deleted_forum_replies' => $deletedForumReplies
        ], $actor);
        $pdo->commit();
    } catch (Throwable $throwable) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        if ($catalogWritten) {
            cts_write_trials_catalog($existingTrials, $existingMetadata);
        }

        throw $throwable;
    }

    cts_json_response([
        'success' => true,
        'message' => 'CSV import replaced the trial catalog.',
        'imported' => count($replacementTrials),
        'created' => $created,
        'preserved' => $preserved,
        'removed' => $removed,
        'deletedForumThreads' => $deletedForumThreads,
        'deletedForumReplies' => $deletedForumReplies,
        'errorCount' => 0,
        'errors' => [],
        'metadata' => $existingMetadata,
        'trials' => $replacementTrials
    ]);
}

try {
    $cts_pdo = cts_db();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');
        header('Expires: 0');
        $catalog = cts_load_trials_payload();
        $trials = $catalog['trials'] ?? [];
        $metadata = $catalog['metadata'] ?? [];
        cts_stream_trials_catalog_response($trials, $metadata);
    }

    $actor = cts_require_role($cts_pdo, 'admin');
    cts_require_csrf();
    $input = cts_read_json_input();

    if ($method === 'POST') {
        if (($input['action'] ?? '') === 'bulk_replace') {
            $rows = isset($input['rows']) && is_array($input['rows']) ? $input['rows'] : [];
            cts_handle_bulk_replace($cts_pdo, $rows, $actor);
        }

        $trialPayload = isset($input['trial']) && is_array($input['trial']) ? $input['trial'] : null;
        if (!$trialPayload) {
            cts_json_response([
                'success' => false,
                'message' => 'Trial payload is required.'
            ], 400);
        }

        $trial = cts_prepare_trial_for_save($trialPayload);
        $validationError = cts_validate_trial_payload($trial);
        if ($validationError !== null) {
            cts_json_response([
                'success' => false,
                'message' => $validationError
            ], 400);
        }

        $catalog = cts_load_trials_payload();
        $trials = $catalog['trials'] ?? [];
        $metadata = $catalog['metadata'] ?? [];
        $trials[] = $trial;
        cts_write_trials_catalog($trials, $metadata);

        cts_audit_log($cts_pdo, 'trial_created', 'trial', $trial['id'], [
            'title' => $trial['title']
        ], $actor);

        cts_json_response([
            'success' => true,
            'message' => 'Trial created successfully.',
            'trial' => $trial,
            'metadata' => $metadata
        ], 201);
    }

    if ($method === 'PUT') {
        $trialId = trim((string)($input['id'] ?? ''));
        $trialPayload = isset($input['trial']) && is_array($input['trial']) ? $input['trial'] : null;

        if ($trialId === '' || !$trialPayload) {
            cts_json_response([
                'success' => false,
                'message' => 'Trial id and payload are required.'
            ], 400);
        }

        $catalog = cts_load_trials_payload();
        $trials = $catalog['trials'] ?? [];
        $metadata = $catalog['metadata'] ?? [];
        $trialIndex = cts_find_trial_index_by_id($trials, $trialId);
        if ($trialIndex === -1) {
            cts_json_response([
                'success' => false,
                'message' => 'Trial not found.'
            ], 404);
        }

        $currentTrial = $trials[$trialIndex];
        $updatedTrial = cts_prepare_trial_for_save(array_merge($currentTrial, $trialPayload, [
            'id' => $trialId,
            'lastUpdated' => cts_now()
        ]));

        $validationError = cts_validate_trial_payload($updatedTrial);
        if ($validationError !== null) {
            cts_json_response([
                'success' => false,
                'message' => $validationError
            ], 400);
        }

        $trials[$trialIndex] = $updatedTrial;
        cts_write_trials_catalog($trials, $metadata);

        cts_audit_log($cts_pdo, 'trial_updated', 'trial', $trialId, [
            'title' => $updatedTrial['title']
        ], $actor);

        cts_json_response([
            'success' => true,
            'message' => 'Trial updated successfully.',
            'trial' => $updatedTrial,
            'metadata' => $metadata
        ]);
    }

    if ($method === 'DELETE') {
        $trialId = trim((string)($input['id'] ?? ''));
        if ($trialId === '') {
            cts_json_response([
                'success' => false,
                'message' => 'Trial id is required.'
            ], 400);
        }

        $catalog = cts_load_trials_payload();
        $trials = $catalog['trials'] ?? [];
        $metadata = $catalog['metadata'] ?? [];
        $trialIndex = cts_find_trial_index_by_id($trials, $trialId);
        if ($trialIndex === -1) {
            cts_json_response([
                'success' => false,
                'message' => 'Trial not found.'
            ], 404);
        }

        $deletedTrial = $trials[$trialIndex];
        array_splice($trials, $trialIndex, 1);
        cts_write_trials_catalog($trials, $metadata);

        cts_audit_log($cts_pdo, 'trial_deleted', 'trial', $trialId, [
            'title' => $deletedTrial['title'] ?? ''
        ], $actor);

        cts_json_response([
            'success' => true,
            'message' => 'Trial deleted successfully.',
            'metadata' => $metadata
        ]);
    }

    cts_json_response([
        'success' => false,
        'message' => 'Method not allowed.'
    ], 405);
} catch (Throwable $throwable) {
    cts_json_response([
        'success' => false,
        'message' => 'Server error: ' . $throwable->getMessage()
    ], 500);
}
