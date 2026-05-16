const express = require('express');
const {
  getUserKey,
  updateUserKey,
  deleteUserKey,
  getUserKeyExpiry,
  getUserKeyValues,
} = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

const invalidateModelCaches = async () => {
  try {
    const { invalidateModelDiscoveryCaches } = require('~/server/services/Models/refreshModels');
    await invalidateModelDiscoveryCaches();
  } catch {
    // Key updates must not fail if model-cache invalidation is unavailable.
  }
};

const mergeJsonUserKeyValue = async ({ userId, name, value }) => {
  let incomingValues;

  try {
    incomingValues = JSON.parse(value);
  } catch {
    return value;
  }

  if (
    incomingValues == null ||
    typeof incomingValues !== 'object' ||
    Array.isArray(incomingValues)
  ) {
    return value;
  }

  let existingValues = {};
  try {
    existingValues = await getUserKeyValues({ userId, name });
  } catch {
    existingValues = {};
  }

  const mergedValues = {
    ...existingValues,
    ...Object.fromEntries(
      Object.entries(incomingValues).filter(
        ([, fieldValue]) => fieldValue !== '' && fieldValue != null,
      ),
    ),
  };

  return JSON.stringify(mergedValues);
};

router.put('/', requireJwtAuth, async (req, res) => {
  if (req.body == null || typeof req.body !== 'object') {
    return res.status(400).send({ error: 'Invalid request body.' });
  }
  const { name, value, expiresAt, merge } = req.body;
  const nextValue =
    merge === true ? await mergeJsonUserKeyValue({ userId: req.user.id, name, value }) : value;

  await updateUserKey({ userId: req.user.id, name, value: nextValue, expiresAt });
  await invalidateModelCaches();
  res.status(201).send();
});

router.delete('/:name', requireJwtAuth, async (req, res) => {
  const { name } = req.params;
  await deleteUserKey({ userId: req.user.id, name });
  await invalidateModelCaches();
  res.status(204).send();
});

router.delete('/', requireJwtAuth, async (req, res) => {
  const { all } = req.query;

  if (all !== 'true') {
    return res.status(400).send({ error: 'Specify either all=true to delete.' });
  }

  await deleteUserKey({ userId: req.user.id, all: true });
  await invalidateModelCaches();

  res.status(204).send();
});

router.get('/', requireJwtAuth, async (req, res) => {
  const { name, includeValue } = req.query;
  const response = await getUserKeyExpiry({ userId: req.user.id, name });

  if (includeValue === 'true' && response.expiresAt !== null) {
    response.value = await getUserKey({ userId: req.user.id, name }).catch(() => '');
  }

  res.status(200).send(response);
});

module.exports = router;
