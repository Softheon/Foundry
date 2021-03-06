/* @flow weak */

import _ from "underscore";
import { setIn, getIn } from "icepick";

import { createSelector } from "reselect";

import { getMetadata } from "metabase/selectors/metadata";

import * as Dashboard from "metabase/meta/Dashboard";

import { getParameterTargetFieldId } from "metabase/meta/Parameter";


import type { CardId, Card } from "metabase/meta/types/Card";
import type { DashCardId } from "metabase/meta/types/Dashboard";
import type {
  ParameterId,
  Parameter,
  ParameterMapping,
  ParameterMappingUIOption,
} from "metabase/meta/types/Parameter";
import { getComputedSettingsForSeries } from "metabase/visualizations/lib/settings/visualization";
import { getFriendlyName } from "metabase/visualizations/lib/utils";
import { getVisualizationTransformed, extractRemappings } from  "metabase/visualizations";
import { create } from "domain";

export type AugmentedParameterMapping = ParameterMapping & {
  dashcard_id: DashCardId,
  overlapMax?: number,
  mappingsWithValues?: number,
  values: Array<string>,
};

export type MappingsByParameter = {
  [key: ParameterId]: {
    [key: DashCardId]: {
      [key: CardId]: AugmentedParameterMapping,
    },
  },
};

export const getDashboardId = state => state.dashboard.dashboardId;
export const getIsEditing = state => state.dashboard.isEditing;
export const getCards = state => state.dashboard.cards;
export const getDashboards = state => state.dashboard.dashboards;
export const getDashcards = state => state.dashboard.dashcards;
export const getCardData = state => state.dashboard.dashcardData;
export const getSlowCards = state => state.dashboard.slowCards;
export const getCardIdList = state => state.dashboard.cardList;
export const getRevisions = state => state.dashboard.revisions;
export const getParameterValues = state => state.dashboard.parameterValues;

export const getDashboard = createSelector(
  [getDashboardId, getDashboards],
  (dashboardId, dashboards) => dashboards[dashboardId],
);

export const getDashboardComplete = createSelector(
  [getDashboard, getDashcards],
  (dashboard, dashcards) =>
    dashboard && {
      ...dashboard,
      ordered_cards: dashboard.ordered_cards
        .map(id => dashcards[id])
        .filter(dc => !dc.isRemoved),
    },
);

export const getNativeDashcardDetail = createSelector(
  [getDashboardComplete],
  (dashboard) => {
    const dashCardMap = new Map();
    const nativeCardToSrcNativeCard = new Map();
    const cardToDashcardData = new Map();
    if (!dashboard) {
      return {
        nativeCardToSrcNativeCard,
        cardToDashcardData
      }
    }
    for (const dashcard of dashboard.ordered_cards) {
      const card = dashcard.card;
      const type = card.dataset_query && card.dataset_query.type;
      if (type === "native") {
          const databaseIdentifier = "[" + "db_"+ card.dataset_query.database + "]";
          const key = databaseIdentifier + card.dataset_query.native.query;
          if (!dashCardMap.has(key)) {
            const cards = [dashcard.card].concat(dashcard.series || []);
            const results = cards.map(card => ({ card, dashcard}));
            dashCardMap.set(key, results);
            nativeCardToSrcNativeCard.set(card.id, card.id);
            cardToDashcardData.set(card.id, {card, dashcard})
          } else {
            const  cards = dashCardMap.get(key);
            const sourceCardId = cards[0].card.id;
            nativeCardToSrcNativeCard.set(card.id, sourceCardId);
          }       
      }
    }
    return {
      nativeCardToSrcNativeCard,
      cardToDashcardData
    };
  }
)

export const getIsDirty = createSelector(
  [getDashboard, getDashcards],
  (dashboard, dashcards) =>
    !!(
      dashboard &&
      (dashboard.isDirty ||
        _.some(
          dashboard.ordered_cards,
          id =>
            !(dashcards[id].isAdded && dashcards[id].isRemoved) &&
            (dashcards[id].isDirty ||
              dashcards[id].isAdded ||
              dashcards[id].isRemoved),
        ))
    ),
);

const getCrossfilterParameter = (state, props) => {
  return props.parameter;
};
export const getDashboardState = state => state.dashboard;
export const getEntitiesState = state => state.entities;


const isTheSameNativeQuery = (a, b) => {
  // check if two native queries are from The same database
  if (a.database !== b.database) {
    return false;
  }
  // check if the two native queries are the same
  if (a.native.query !== b.native.query) {
    return false;
  }
  return true;
}
const isTheSameStructureQuery = (a, b) => {
  if (a.database !== b.database) {
    return false;
  }
  if (a.query["source-table"] !== b.query["source-table"]) {
    return false;
  }
  return true;
}

export const getSQLDashcards = createSelector(
  [getDashcards],
  (dashcards) => {
    const nativeCards = [];
    Object.values(dashcards).map(dashcard => {
        const card = dashcard.card;
        const { query_type } = card;
        if (query_type === "native") {
          nativeCards.push({
            card,
            dashcard_id: dashcard.id,
            dashboard_id: dashcard.dashboard_id
          });
        }
    });
    return nativeCards;
  }
)

export const getCardList = createSelector(
  [getCardIdList, getCards],
  (cardIdList, cards) => cardIdList && cardIdList.map(id => cards[id]),
);

export const getEditingParameterId = state =>
  state.dashboard.editingParameterId;

export const getEditingParameter = createSelector(
  [getDashboard, getEditingParameterId],
  (dashboard, editingParameterId) =>
    editingParameterId != null
      ? _.findWhere(dashboard.parameters, { id: editingParameterId })
      : null,
);

export const getIsEditingParameter = state =>
  state.dashboard.editingParameterId != null;

const getCard = (state, props) => props.card;
const getDashCard = (state, props) => props.dashcard;

export const getParameterTarget = createSelector(
  [getEditingParameter, getCard, getDashCard],
  (parameter, card, dashcard) => {
    const mapping = _.findWhere(dashcard.parameter_mappings, {
      card_id: card.id,
      parameter_id: parameter.id,
    });
    return mapping && mapping.target;
  },
);

export const getMappingsByParameter = createSelector(
  [getMetadata, getDashboardComplete],
  (metadata, dashboard) => {
    if (!dashboard) {
      return {};
    }

    let mappingsByParameter: MappingsByParameter = {};
    let mappings: Array<AugmentedParameterMapping> = [];
    let countsByParameter = {};
    for (const dashcard of dashboard.ordered_cards) {
      const cards: Array<Card> = [dashcard.card].concat(dashcard.series);
      for (let mapping: ParameterMapping of dashcard.parameter_mappings || []) {
        const card = _.findWhere(cards, { id: mapping.card_id });
        const fieldId =
          card && getParameterTargetFieldId(mapping.target, card.dataset_query);
        const field = metadata.fields[fieldId];
        const values = (field && field.fieldValues()) || [];
        if (values.length) {
          countsByParameter[mapping.parameter_id] =
            countsByParameter[mapping.parameter_id] || {};
        }
        for (const value of values) {
          countsByParameter[mapping.parameter_id][value] =
            (countsByParameter[mapping.parameter_id][value] || 0) + 1;
        }

        let augmentedMapping: AugmentedParameterMapping = {
          ...mapping,
          parameter_id: mapping.parameter_id,
          dashcard_id: dashcard.id,
          card_id: mapping.card_id,
          field_id: fieldId,
          values,
        };
        mappingsByParameter = setIn(
          mappingsByParameter,
          [mapping.parameter_id, dashcard.id, mapping.card_id],
          augmentedMapping,
        );
        mappings.push(augmentedMapping);
      }
    }
    let mappingsWithValuesByParameter = {};
    // update max values overlap for each mapping
    for (let mapping of mappings) {
      if (mapping.values && mapping.values.length > 0) {
        let overlapMax = Math.max(
          ...mapping.values.map(
            value => countsByParameter[mapping.parameter_id][value],
          ),
        );
        mappingsByParameter = setIn(
          mappingsByParameter,
          [
            mapping.parameter_id,
            mapping.dashcard_id,
            mapping.card_id,
            "overlapMax",
          ],
          overlapMax,
        );
        mappingsWithValuesByParameter[mapping.parameter_id] =
          (mappingsWithValuesByParameter[mapping.parameter_id] || 0) + 1;
      }
    }
    // update count of mappings with values
    for (let mapping of mappings) {
      mappingsByParameter = setIn(
        mappingsByParameter,
        [
          mapping.parameter_id,
          mapping.dashcard_id,
          mapping.card_id,
          "mappingsWithValues",
        ],
        mappingsWithValuesByParameter[mapping.parameter_id] || 0,
      );
    }

    return mappingsByParameter;
  },
);

/** Returns the dashboard's parameters objects, with field_id added, if appropriate */
export const getParameters = createSelector(
  [getMetadata, getDashboard, getMappingsByParameter],
  (metadata, dashboard, mappingsByParameter) =>
    ((dashboard && dashboard.parameters) || []).map(parameter => {
      // get the unique list of field IDs these mappings reference
      const fieldIds = _.chain(mappingsByParameter[parameter.id])
        .map(_.values)
        .flatten()
        .map(m => m.field_id)
        .uniq()
        .filter(fieldId => fieldId != null)
        .value();
      const fieldIdsWithFKResolved = _.chain(fieldIds)
        .map(id => metadata.fields[id])
        .filter(f => f)
        .map(f => (f.target || f).id)
        .uniq()
        .value();
      return {
        ...parameter,
        field_ids: fieldIds,
        // if there's a single uniqe field (accounting for FKs) then
        // include it as the one true field_id
        field_id:
          fieldIdsWithFKResolved.length === 1
            ? fieldIdsWithFKResolved[0]
            : null,
      };
    }),
);

export const makeGetParameterMappingOptions = () => {
  const getParameterMappingOptions = createSelector(
    [getMetadata, getEditingParameter, getCard],
    (
      metadata,
      parameter: Parameter,
      card: Card,
    ): Array<ParameterMappingUIOption> => {
      return Dashboard.getParameterMappingOptions(metadata, parameter, card);
    },
  );
  return getParameterMappingOptions;
};
