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

// export const getCrossFilterValues = createSelector(
//   [getDashcards, getCardData, getCrossfilterParameter],
//   (dashcards, dashcardData, crossfilterParameter) => {
//     const dimensionNames = [];
//     const {dashcard_id, card_id} = crossfilterParameter
//     const dashcardsWithTheSameQuerySrc = [];
//     const isNative = dashcards[dashcard_id].card.query_type === "native";
//     const sourceQuery = dashcards[dashcard_id].card.dataset_query;
//     if (!sourceQuery) {
//       return [];
//     }
//     Object.values(dashcards).map(dashcard => {
//       let currSrcQuery = dashcard.card.dataset_query;
//       if (isNative && dashcard.card.query_type === "native") {
//          if (isTheSameNativeQuery(sourceQuery, currSrcQuery)) {
//            dashcardsWithTheSameQuerySrc.push(dashcard);
//          }
//       } else if (!isNative && dashcard.card.query_type === "query"){
//         if (isTheSameStructureQuery(sourceQuery, currSrcQuery)) {
//           dashcardsWithTheSameQuerySrc.push(dashcard);
//         }
//       }
//     })

//     for(const dashcard of dashcardsWithTheSameQuerySrc) {
//       const card = dashcard.card;
//       const mainCard = {
//         ...card,
//         visualization_settings: {
//           ...card.visualization_settings,
//           ...dashcard.visualization_settings,
//         },
//       };
//       const cards = [mainCard].concat(dashcard.series || []);
//       let series = cards.map(card => ({
//         ...getIn(dashcardData, [dashcard.id, card.id]),
//         card: card,
//       }));

//       const loading = !(series.length > 0 && _.every(series, s => s.data));
      
//       // don't try to load settings unless data is loaded
//       if (loading) {
//         continue;
//       }
//       const visualizationTransformed = getVisualizationTransformed(extractRemappings(series));
//       series = visualizationTransformed.series;
//       const settings = getComputedSettingsForSeries(series);
//       const [{ data: {cols} }] = series;
//       const displayType = card.display;
//       if (displayType === "pie" &&  settings["pie._dimensionIndex"]) {
//         const dimensionIndex = settings["pie._dimensionIndex"];
//         const name = getFriendlyName(cols[dimensionIndex]);
//         dimensionNames.push(name);
//       }
//       else if (settings["graph.dimensions"]){
//         const dimensions = (settings["graph.dimensions"] || []).filter(
//           name => name
//         );
//         if (dimensions.length > 0) {
//           dimensionNames.push(dimensions[0])
//         }
//       }
//     }
//     return _.unique(dimensionNames);
//   },
// );

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
            dashcard_id: dashcard.id
          });
        }
    });
    return nativeCards;
  }
)

export const getCrossFilterValues = createSelector(
  [getDashcards, getSQLDashcards, getCardData, getCrossfilterParameter],
  (dashcards, sqlDashcards, dashcardData, crossfilterParameter) => {
    const dimensionNames = [];
    const cfDashcardId = crossfilterParameter.dashcard_id;
    const cfDatabaseId = crossfilterParameter.database_id;
    const dashcardsWithTheSQLQueryString = [];
    const sourceQueryString = dashcards[cfDashcardId].card.dataset_query.native.query;
    if (!sourceQueryString){
      return dimensionNames;
    }

    sqlDashcards.map(sqlDashcard => {
      const query = sqlDashcard.card.dataset_query.native.query;
      if (sqlDashcard.card.database_id === cfDatabaseId && query === sourceQueryString ) {
        dashcardsWithTheSQLQueryString.push(sqlDashcard);
      }
    })
    dashcardsWithTheSQLQueryString.map(sqlDashcard => {
      const card = sqlDashcard.card;
      const dashcard = dashcards[sqlDashcard.dashcard_id];
      const mainCard = {
          ...card,
          visualization_settings:{
            ...card.visualization_settings,
            ...dashcard.visualization_settings,
          }
      }
      const cards = [mainCard].concat(dashcard.series || []);
      let  series = cards.map(card => ({
        ...getIn(dashcardData, [dashcard.id, card.id]),
        card: card
      }));

      const loading = !(series.length > 0 && _.every(series, s => s.data));
      if (loading) {
          return;
      }
      const visualizationTransformed = getVisualizationTransformed(extractRemappings(series));
      series = visualizationTransformed.series;
      const settings = getComputedSettingsForSeries(series);
      
      const [{ data: {cols} }] = series;
      const displayType = card.display;
      if (displayType === "pie") {
        const dimensionIndex = settings["pie._dimensionIndex"];
        const name = getFriendlyName(cols[dimensionIndex]);
        dimensionNames.push(name);
      } else if (settings["graph.dimensions"]){
        const dimensions = (settings["graph.dimensions"] || []).filter(
          name => name
        );
        if (dimensions.length > 0) {
          dimensionNames.push(dimensions[0])
        }
      }


    })
    return _.unique(dimensionNames);
  }
);

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
