UPDATE `downloads`
SET `external_id` = NULL
WHERE `acquisition_state` = 'removed';
