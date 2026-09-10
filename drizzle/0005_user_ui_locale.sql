ALTER TABLE users ADD COLUMN ui_locale TEXT CHECK (ui_locale IS NULL OR ui_locale IN ('en', 'fr'));
