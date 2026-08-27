-- Adds a real "phone" column to User so /utilisateurs can persist and read
-- back the phone number entered on account creation, instead of getUsers()
-- hardcoding an empty string. Nullable, non-destructive.

ALTER TABLE "User" ADD COLUMN "phone" TEXT;
