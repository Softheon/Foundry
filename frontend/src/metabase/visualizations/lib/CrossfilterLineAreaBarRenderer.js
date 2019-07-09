/* @flow weak */

import crossfilter from "crossfilter";
import d3 from "d3";
import dc from "dc";
import _ from "underscore";
import { updateIn } from "icepick";
import { t } from "c-3po";
import { lighten } from "metabase/lib/colors";

import {
  computeSplit,
  getFriendlyName,
  getXValues,
  colorShades
} from "./utils";

import { minTimeseriesUnit, computeTimeseriesDataInverval } from "./timeseries";

import { computeNumericDataInverval } from "./numeric";

import {
  applyChartTimeseriesXAxis,
  applyChartQuantitativeXAxis,
  applyChartOrdinalXAxis,
  applyChartYAxis
} from "./apply_axis";

import { setupTooltips } from "./apply_tooltips";
import { getTrendDataPointsFromInsight } from "./trends";

import fillMissingValuesInDatas from "./fill_data";

import { keyForSingleSeries } from "metabase/visualizations/lib/settings/series";

import {
  HACK_parseTimestamp,
  NULL_DIMENSION_WARNING,
  forceSortedGroupsOfGroups,
  initChart, // TODO - probably better named something like `initChartParent`
  initCrossfilterChart,
  makeIndexMap,
  reduceGroup,
  isTimeseries,
  isQuantitative,
  isHistogram,
  isOrdinal,
  isHistogramBar,
  isStacked,
  isNormalized,
  getFirstNonEmptySeries,
  isDimensionTimeseries,
  isDimensionNumeric,
  isRemappedToString,
  isMultiCardSeries
} from "./renderer_utils";

import lineAndBarOnRender, {crossfilterLineandBarOnRender} from "./LineAreaBarPostRender";

import { isStructured } from "metabase/meta/Card";

import {
  updateDateTimeFilter,
  updateNumericFilter
} from "metabase/qb/lib/actions";

import { lineAddons } from "./graph/addons";
import { initCrossfilterBrush } from "./graph/CrossfilterBrush";

import type { VisualizationProps } from "metabase/meta/types/Visualization";

const BAR_PADDING_RATIO = 0.2;
const DEFAULT_INTERPOLATION = "linear";

const UNAGGREGATED_DATA_WARNING = col =>
  t`"${getFriendlyName(
    col
  )}" is an unaggregated field: if it has more than one value at a point on the x-axis, the values will be summed.`;

const enableBrush = (series, onChangeCardAndRun) =>
  !!(!isMultiCardSeries(series) && !isRemappedToString(series));

/************************************************************ SETUP ************************************************************/

function checkSeriesIsValid({ series, maxSeries }) {
  if (series.length > 1) {
    throw new Error(
      t`This chart type does not support multiple series if dynamic filter is applied.`
    );
  }
  const seriesData = series[0].data;
  if (seriesData.rows.length === 0 || _.isEqual(seriesData.rows, [[null]])) {
    throw new Error(t`This main series is an empty series.`);
  }
}

function getDatas({ settings, series }, warn) {
  return series.map(s =>
    s.data.rows.map(row => {
      const newRow = [
        // don't parse as timestamp if we're going to display as a quantitative scale, e.x. years and Unix timestamps
        isDimensionTimeseries(series) && !isQuantitative(settings)
          ? HACK_parseTimestamp(row[0], s.data.cols[0].unit, warn)
          : isDimensionNumeric(series) ? row[0] : String(row[0]),
        ...row.slice(1)
      ];
      // $FlowFixMe: _origin not typed
      newRow._origin = row._origin;
      return newRow;
    })
  );
}

function getFormatedCrossfilterData(
  { settings, series, crossfilterData },
  isScatter = false,
  warn
) {
  const mainSeries = series[0];
  let data = crossfilterData();
  data = isScatter
    ? data.map(d => [d.key[0], d.key[1], d.key[2]])
    : data.map(d => [d.key, d.value]);
  const rows = data.map(row => {
    const newRow = [
      isDimensionTimeseries(series) && !isQuantitative(settings)
        ? HACK_parseTimestamp(row[0], mainSeries.data.cols[0].unit, warn)
        : isDimensionNumeric(series) ? row[0] : String(row[0]),
      ...row.slice(1)
    ];
    return newRow;
  });

  return [rows];
}

function getXInterval({ settings, series }, xValues) {
  const mainSeries = series[0];
  if (isTimeseries(settings)) {
    // compute the interval
    const mainUnit = mainSeries.data.cols[0].unit;

    // const unit = minTimeseriesUnit(series.map(s => s.data.cols[0].unit));
    const unit = minTimeseriesUnit([mainUnit]);
    return computeTimeseriesDataInverval(xValues, unit);
  } else if (isQuantitative(settings) || isHistogram(settings)) {
    // Get the bin width from binning_info, if available
    // TODO: multiseries?
    const binningInfo = mainSeries.data.cols[0].binning_info;
    if (binningInfo) {
      return binningInfo.bin_width;
    }

    // Otherwise try to infer from the X values
    return computeNumericDataInverval(xValues);
  }
}

function getXAxisProps(props, datas) {
  const xValues = getXValues(datas);

  return {
    xValues,
    xDomain: d3.extent(xValues),
    xInterval: getXInterval(props, xValues),
    isHistogramBar: isHistogramBar(props)
  };
}

///------------------------------------------------------------ DIMENSIONS & GROUPS ------------------------------------------------------------///

function getDimensionsAndGroupsForScatterChart(
  datas,
  { getGroup, getDimension }
) {

  const dimension = getDimension();
  const group = getGroup();
  const groups = [[group]];
  return { dimension, groups };
}

/// Add '% ' in from of the names of the appropriate series. E.g. 'Sum' becomes '% Sum'
function addPercentSignsToDisplayNames(series) {
  return series.map(s =>
    updateIn(s, ["data", "cols", 1], col => ({
      ...col,
      display_name: "% " + getFriendlyName(col)
    }))
  );
}

function getDimensionsAndGroupsAndUpdateSeriesDisplayNamesForStackedChart(
  props,
  datas,
  warn
) {
  const dataset = crossfilter();

  const normalized = isNormalized(props.settings, datas);
  // get the sum of the metric for each dimension value in order to scale
  const scaleFactors = {};
  if (normalized) {
    for (const data of datas) {
      for (const [d, m] of data) {
        scaleFactors[d] = (scaleFactors[d] || 0) + m;
      }
    }

    props.series = addPercentSignsToDisplayNames(props.series);
  }

  datas.map((data, i) =>
    dataset.add(
      data.map(d => ({
        [0]: d[0],
        [i + 1]: normalized ? d[1] / scaleFactors[d[0]] : d[1]
      }))
    )
  );

  const dimension = dataset.dimension(d => d[0]);
  const groups = [
    datas.map((data, seriesIndex) =>
      reduceGroup(dimension.group(), seriesIndex + 1, () =>
        warn(UNAGGREGATED_DATA_WARNING(props.series[seriesIndex].data.cols[0]))
      )
    )
  ];

  return { dimension, groups };
}

function getDimensionsAndGroupsForOther(
  { series, getGroup, getDimension },
  datas,
  warn
) {
  const dimension = getDimension();
  const group = getGroup();
  const groups = [[group]];
  return { dimension, groups };
}

/// Return an object containing the `dimension` and `groups` for the chart(s).
/// For normalized stacked charts, this also updates the dispaly names to add a percent in front of the name (e.g. 'Sum' becomes '% Sum')
function getDimensionsAndGroupsAndUpdateSeriesDisplayNames(props, datas, warn) {
  const { settings, chartType } = props;

  return chartType === "scatter"
    ? getDimensionsAndGroupsForScatterChart(datas, props)
    : isStacked(settings, datas)
      ? getDimensionsAndGroupsAndUpdateSeriesDisplayNamesForStackedChart(
          props,
          datas,
          warn
        )
      : getDimensionsAndGroupsForOther(props, datas, warn);
}

///------------------------------------------------------------ Y AXIS PROPS ------------------------------------------------------------///

function getYAxisSplit(
  { settings, chartType, isScalarSeries, series },
  datas,
  yExtents
) {
  const seriesAxis = series.map(single => settings.series(single)["axis"]);
  const left = [];
  const right = [];
  const auto = [];
  for (const [index, axis] of seriesAxis.entries()) {
    if (axis === "left") {
      left.push(index);
    } else if (axis === "right") {
      right.push(index);
    } else {
      auto.push(index);
    }
  }

  // don't auto-split if the metric columns are all identical, i.e. it's a breakout multiseries
  const hasDifferentYAxisColumns =
    _.uniq(series.map(s => JSON.stringify(s.data.cols[1]))).length > 1;
  if (
    !isScalarSeries &&
    chartType !== "scatter" &&
    !isStacked(settings, datas) &&
    hasDifferentYAxisColumns &&
    settings["graph.y_axis.auto_split"] !== false
  ) {
    // NOTE: this version computes the split after assigning fixed left/right
    // which causes other series to move around when changing the setting
    // return computeSplit(yExtents, left, right);

    // NOTE: this version computes a split with all axis unassigned, then moves
    // assigned ones to their correct axis
    const [autoLeft, autoRight] = computeSplit(yExtents);
    return [
      _.uniq([...left, ...autoLeft.filter(index => !seriesAxis[index])]),
      _.uniq([...right, ...autoRight.filter(index => !seriesAxis[index])])
    ];
  } else {
    // assign all auto to the left
    return [[...left, ...auto], right];
  }
}

function getYAxisSplitLeftAndRight(series, yAxisSplit, yExtents) {
  return yAxisSplit.map(indexes => ({
    series: indexes.map(index => series[index]),
    extent: d3.extent([].concat(...indexes.map(index => yExtents[index])))
  }));
}

function getIsSplitYAxis(left, right) {
  return right && right.series.length && (left && left.series.length > 0);
}

function getYAxisProps(props, groups, datas) {
  const yExtents = groups.map(group => d3.extent(group[0].all(), d => d.value));
  const yAxisSplit = getYAxisSplit(props, datas, yExtents);

  const [yLeftSplit, yRightSplit] = getYAxisSplitLeftAndRight(
    props.series,
    yAxisSplit,
    yExtents
  );

  return {
    yExtents,
    yAxisSplit,
    yExtent: d3.extent([].concat(...yExtents)),
    yLeftSplit,
    yRightSplit,
    isSplit: getIsSplitYAxis(yLeftSplit, yRightSplit)
  };
}

function makeBrushChangeFunctions({
  series,
  onChangeCardAndRun,
  redrawCrossfilterGroup
}) {
  let _isBrushing = false;

  const isBrushing = () => _isBrushing;

  function onBrushChange() {
    _isBrushing = true;
  }

  function onBrushEnd(range, chart) {
    _isBrushing = false;
    if (range) {
      redrawCrossfilterGroup();
    }
  }

  return { isBrushing, onBrushChange, onBrushEnd };
}

/************************************************************ INDIVIDUAL CHART SETUP ************************************************************/

function getDcjsChart(cardType, parent, groupId) {
  switch (cardType) {
    case "line":
      return lineAddons(dc.lineChart(parent, groupId));
    case "area":
      return lineAddons(dc.lineChart(parent, groupId));
    case "bar":
      return dc.barChart(parent, groupId);
    case "scatter":
      return dc.bubbleChart(parent, groupId);
    default:
      return dc.barChart(parent, groupId);
  }
}

function applyChartLineBarSettings(
  chart,
  settings,
  chartType,
  seriesSettings,
  forceCenterBar
) {
  // LINE/AREA:
  // for chart types that have an 'interpolate' option (line/area charts), enable based on settings
  if (chart.interpolate) {
    chart.interpolate(
      seriesSettings["line.interpolate"] ||
        settings["line.interpolate"] ||
        DEFAULT_INTERPOLATION
    );
  }

  // AREA:
  if (chart.renderArea) {
    chart.renderArea(chartType === "area");
  }

  // BAR:
  if (chart.barPadding) {
    chart
      .barPadding(BAR_PADDING_RATIO)
      .centerBar(
        forceCenterBar || settings["graph.x_axis.scale"] !== "ordinal"
      );
  }
}

// TODO - give this a good name when I figure out what it does
function doScatterChartStuff(
  chart,
  datas,
  index,
  { yExtent, yExtents },
  { isTimeDimension, isNumericDimension, keyColumn }
) {
  chart.keyAccessor(d => {
    const key = d.key[0];
   return isTimeDimension
        ? HACK_parseTimestamp(key, keyColumn.unit, null)
        : isNumericDimension ? key : String(key);
    
  });
  chart.valueAccessor(d => d.key[1]);

  if (chart.radiusValueAccessor) {
    const isBubble = datas[index][0].length > 2;
    if (isBubble) {
      const BUBBLE_SCALE_FACTOR_MAX = 64;
      chart.radiusValueAccessor(d => d.value).r(
        d3.scale
          .sqrt()
          .domain([0, yExtent[1] * BUBBLE_SCALE_FACTOR_MAX])
          .range([0, 1])
      );
    } else {
      chart.radiusValueAccessor(d => 1);
      chart.MIN_RADIUS = 3;
    }
    chart.minRadiusWithLabel(Infinity);
  }

  // update scatter filterhandler
  chart.filterHandler((dimension, filters) => {
    if (filters.length === 0) {
      dimension.filter(null);
    } else {
      dimension.filterFunction(function(d) {
        const dimensionKey = d[0];
        for (let i = 0; i < filters.length; i++) {
          let filter = filters[i];
          let value = isTimeDimension 
            ?  HACK_parseTimestamp(dimensionKey, keyColumn.unit, x=>x)
            : isNumericDimension ? dimensionKey : String(dimensionKey);
          if (filter.isFiltered && filter.isFiltered(value)) { 
            return true;
          } else if (filter <= value && filter >= value) {
            return true;
          }
        }   
        return false;
      });
    }
    return filters;
  });

  chart.isSelectedNode = d => {
    const filter = chart.filter();
    const dimensionKey = d.key[0];
    const value = isTimeDimension 
            ?  HACK_parseTimestamp(dimensionKey, keyColumn.unit, x=>x)
            : isNumericDimension ? dimensionKey : String(dimensionKey);
     if (filter.isFiltered && filter.isFiltered(value)) {
       return true;
     } else if (filter <= value && filter >= value) {
       return true;
     }
     return false;
  }
}

/// set the colors for a CHART based on the number of series and type of chart
/// see http://dc-js.github.io/dc.js/docs/html/dc.colorMixin.html
function setChartColor({ series, settings, chartType }, chart, groups, index) {
  const group = groups[index];
  const colorsByKey = settings["series_settings.colors"] || {};
  const key = keyForSingleSeries(series[index]);
  const color = colorsByKey[key] || "black";

  // multiple series
  if (groups.length > 1 || chartType === "scatter") {
    // multiple stacks
    if (group.length > 1) {
      // compute shades of the assigned color
      chart.ordinalColors(colorShades(color, group.length));
    } else {
      chart.colors(color);
    }
  } else {
    chart.ordinalColors(
      series.map(single => colorsByKey[keyForSingleSeries(single)])
    );
  }
}

// returns the series "display" type, either from the series settings or stack_display setting
function getSeriesDisplay(settings, single) {
  if (settings["stackable.stack_type"] != null) {
    return settings["stackable.stack_display"];
  } else {
    return settings.series(single).display;
  }
}

/// Return a sequence of little charts for each of the groups.
function getCharts(
  props,
  yAxisProps,
  parent,
  datas,
  groups,
  dimension,
  { onBrushChange, onBrushEnd }
) {
  const {
    settings,
    chartType,
    series,
    onChangeCardAndRun,
    redrawCrossfilterGroup
  } = props;
  const { yAxisSplit } = yAxisProps;

  const isHeterogenous =
    _.uniq(series.map(single => getSeriesDisplay(settings, single))).length > 1;
  const isHeterogenousOrdinal =
    settings["graph.x_axis.scale"] === "ordinal" && isHeterogenous;

  if (isHeterogenousOrdinal) {
    // HACK: ordinal + mix of line and bar results in uncentered points, shift by
    // half the width
    parent.on("renderlet.shift", () => {
      // ordinal, so we can get the first two points to determine spacing
      const scale = parent.x();
      const values = scale.domain();
      const spacing = scale(values[1]) - scale(values[0]);
      parent
        .svg()
        // shift bar/line and dots
        .selectAll(".stack, .dc-tooltip")
        .each(function() {
          this.style.transform = `translate(${spacing / 2}px, 0)`;
        });
    });
  }
  const column = series[0].data.cols[0];
  const isTimeDimension = isDimensionTimeseries(series);
  const isNumericDimension = isDimensionNumeric(series);
   const mainSeries = series[0];
  return groups.map((group, index) => {
    const single = series[index];
    const seriesSettings = settings.series(single);
    const seriesChartType = getSeriesDisplay(settings, single) || chartType;

    const chart = getDcjsChart(seriesChartType, parent, props.chartGroup);

    if (enableBrush(series, onChangeCardAndRun)) {
      initCrossfilterBrush(parent, chart, onBrushChange, onBrushEnd);
    }

    // disable clicks
    chart.onClick = () => {};

    chart.keyAccessor(d => {
      return isTimeDimension
        ? HACK_parseTimestamp(d.key, column.unit, null)
        : isNumericDimension ? d.key : String(d.key);
    });

    if (isTimeDimension) {
      chart.filterHandler((dimension, filters) => {
        if (filters.length === 0) {
          dimension.filter(null);
        } else if (filters.length === 1 && !filters[0].isFiltered) {
          // single value and not a function-based filter
          dimension.filterExact(filters[0]);
        } else {
          dimension.filterFunction(function(d) {
            for (let i = 0; i < filters.length; i++) {
              let filter = filters[i];
              let value = HACK_parseTimestamp(d, column.unit, null);
              if (filter.isFiltered && filter.isFiltered(value)) {
                return true;
              } else if (filter <= value && filter >= value) {
                return true;
              }
            }
            return false;
          });
        }
        return filters;
      });
    }

    chart.dimension(dimension).group(group[0]);

    if (chartType === "scatter") {
      doScatterChartStuff(chart, datas, index, yAxisProps, {
        isTimeDimension,
        isNumericDimension,
        keyColumn: column
      });
    }

    setChartColor(props, chart, groups, index);

    for (let i = 1; i < group.length; i++) {
      chart.stack(group[i]);
    }

    applyChartLineBarSettings(
      chart,
      settings,
      seriesChartType,
      seriesSettings,
      isHeterogenousOrdinal
    );

    return chart;
  });
}

/************************************************************ OTHER SETUP ************************************************************/

/// Add a `goalChart` to the end of `charts`, and return an appropriate `onGoalHover` function as needed.
function addGoalChartAndGetOnGoalHover(
  { settings, onHoverChange },
  xDomain,
  parent,
  charts
) {
  if (!settings["graph.show_goal"]) {
    return () => {};
  }

  const goalValue = settings["graph.goal_value"];
  const goalData = [[xDomain[0], goalValue], [xDomain[1], goalValue]];
  const goalDimension = crossfilter(goalData).dimension(d => d[0]);

  // Take the last point rather than summing in case xDomain[0] === xDomain[1], e.x. when the chart
  // has just a single row / datapoint
  const goalGroup = goalDimension
    .group()
    .reduce((p, d) => d[1], (p, d) => p, () => 0);
  const goalIndex = charts.length;

  const goalChart = dc
    .lineChart(parent)
    .dimension(goalDimension)
    .group(goalGroup)
    .on("renderlet", function(chart) {
      // remove "sub" class so the goal is not used in voronoi computation
      chart
        .select(".sub._" + goalIndex)
        .classed("sub", false)
        .classed("goal", true);
    });
  charts.push(goalChart);

  return element => {
    onHoverChange(
      element && {
        element,
        data: [{ key: settings["graph.goal_label"], value: goalValue }]
      }
    );
  };
}

function findSeriesIndexForColumnName(series, colName) {
  return (
    _.findIndex(series, ({ data: { cols } }) =>
      _.findWhere(cols, { name: colName })
    ) || 0
  );
}

const TREND_LINE_POINT_SPACING = 25;

function addTrendlineChart(
  { series, settings, onHoverChange },
  { xDomain },
  { yAxisSplit },
  parent,
  charts
) {
  if (!settings["graph.show_trendline"]) {
    return;
  }

  const rawSeries = series._raw || series;
  const insights = rawSeries[0].data.insights || [];

  for (const insight of insights) {
    if (insight.slope != null && insight.offset != null) {
      const index = findSeriesIndexForColumnName(series, insight.col);
      const seriesSettings = settings.series(series[index]);
      const color = lighten(seriesSettings.color, 0.25);

      const points = Math.round(parent.width() / TREND_LINE_POINT_SPACING);
      const trendData = getTrendDataPointsFromInsight(insight, xDomain, points);
      const trendDimension = crossfilter(trendData).dimension(d => d[0]);

      // Take the last point rather than summing in case xDomain[0] === xDomain[1], e.x. when the chart
      // has just a single row / datapoint
      const trendGroup = trendDimension
        .group()
        .reduce((p, d) => d[1], (p, d) => p, () => 0);
      const trendIndex = charts.length;

      const trendChart = dc
        .lineChart(parent)
        .dimension(trendDimension)
        .group(trendGroup)
        .on("renderlet", function(chart) {
          // remove "sub" class so the trend is not used in voronoi computation
          chart
            .select(".sub._" + trendIndex)
            .classed("sub", false)
            .classed("trend", true);
        })
        .colors([color])
        .useRightYAxis(yAxisSplit.length > 1 && yAxisSplit[1].includes(index))
        .interpolate("cardinal");

      charts.push(trendChart);
    }
  }
}

function applyXAxisSettings(parent, series, xAxisProps) {
  if (isTimeseries(parent.settings)) {
    applyChartTimeseriesXAxis(parent, series, xAxisProps);
  } else if (isQuantitative(parent.settings)) {
    applyChartQuantitativeXAxis(parent, series, xAxisProps);
  } else {
    applyChartOrdinalXAxis(parent, series, xAxisProps);
  }
}

function applyYAxisSettings(parent, { yLeftSplit, yRightSplit }) {
  if (yLeftSplit && yLeftSplit.series.length > 0) {
    applyChartYAxis(parent, yLeftSplit.series, yLeftSplit.extent, "left");
  }
  if (yRightSplit && yRightSplit.series.length > 0) {
    applyChartYAxis(parent, yRightSplit.series, yRightSplit.extent, "right");
  }
}

// TODO - better name
function doGroupedBarStuff(parent) {
  parent.on("renderlet.grouped-bar", function(chart) {
    // HACK: dc.js doesn't support grouped bar charts so we need to manually resize/reposition them
    // https://github.com/dc-js/dc.js/issues/558
    const barCharts = chart
      .selectAll(".sub rect:first-child")[0]
      .map(node => node.parentNode.parentNode.parentNode);
    if (barCharts.length > 0) {
      const oldBarWidth = parseFloat(
        barCharts[0].querySelector("rect").getAttribute("width")
      );
      const newBarWidthTotal = oldBarWidth / barCharts.length;
      const seriesPadding =
        newBarWidthTotal < 4 ? 0 : newBarWidthTotal < 8 ? 1 : 2;
      const newBarWidth = Math.max(1, newBarWidthTotal - seriesPadding);

      chart.selectAll("g.sub rect").attr("width", newBarWidth);
      barCharts.forEach((barChart, index) => {
        barChart.setAttribute(
          "transform",
          "translate(" + (newBarWidth + seriesPadding) * index + ", 0)"
        );
      });
    }
  });
}

// TODO - better name
function doHistogramBarStuff(parent) {
  parent.on("renderlet.histogram-bar", function(chart) {
    const barCharts = chart
      .selectAll(".sub rect:first-child")[0]
      .map(node => node.parentNode.parentNode.parentNode);
    if (!barCharts.length) {
      return;
    }

    // manually size bars to fill space, minus 1 pixel padding
    const bars = barCharts[0].querySelectorAll("rect");
    const barWidth = parseFloat(bars[0].getAttribute("width"));
    const newBarWidth =
      parseFloat(bars[1].getAttribute("x")) -
      parseFloat(bars[0].getAttribute("x")) -
      1;
    if (newBarWidth > barWidth) {
      chart.selectAll("g.sub .bar").attr("width", newBarWidth);
    }

    // shift half of bar width so ticks line up with start of each bar
    for (const barChart of barCharts) {
      barChart.setAttribute("transform", `translate(${barWidth / 2}, 0)`);
    }
  });
}

/************************************************************ PUTTING IT ALL TOGETHER ************************************************************/

type LineAreaBarProps = VisualizationProps & {
  chartType: "line" | "area" | "bar" | "scatter",
  isScalarSeries: boolean,
  maxSeries: number
};

type DeregisterFunction = () => void;

export default function lineAreaBar(
  element: Element,
  props: LineAreaBarProps
): DeregisterFunction {
  const { onRender, isScalarSeries, settings, series, chartType } = props;
  const warnings = {};
  const warn = id => {
    warnings[id] = (warnings[id] || 0) + 1;
  };

  checkSeriesIsValid(props);

  // force histogram to be ordinal axis with zero-filled missing points
  settings["graph.x_axis._scale_original"] = settings["graph.x_axis.scale"];
  if (isHistogram(settings)) {
    // FIXME: need to handle this on series settings now
    settings["line.missing"] = "zero";
    settings["graph.x_axis.scale"] = "ordinal";
  }
  const isScatterChart = chartType === "scatter" ? true : false;
  //let datas = getDatas(props, warn);
  let datas = getFormatedCrossfilterData(props, isScatterChart, warn);
  let xAxisProps = getXAxisProps(props, datas);

  //datas = fillMissingValuesInDatas(props, xAxisProps, datas);
  // xAxisProps = getXAxisProps(props, datas);

  if (isScalarSeries) {
    xAxisProps.xValues = datas.map(data => data[0][0]);
  } // TODO - what is this for?

  const {
    dimension,
    groups
  } = getDimensionsAndGroupsAndUpdateSeriesDisplayNames(props, datas, warn);

  const yAxisProps = getYAxisProps(props, groups, datas);

  // Don't apply to linear or timeseries X-axis since the points are always plotted in order
  if (!isTimeseries(settings) && !isQuantitative(settings)) {
    forceSortedGroupsOfGroups(groups, makeIndexMap(xAxisProps.xValues));
  }

  const parent = dc.compositeChart(element);
  initCrossfilterChart(parent, element);

  parent.settings = settings;
  parent.series = props.series;
  parent.dimension(props.getDimension());
  parent.group(props.getGroup());

  const column = series[0].data.cols[0];
  const mainSeries = series[0];
  const isTimeDimension =
    isDimensionTimeseries(series) && !isQuantitative(settings);
  const isNumericDimension = isDimensionNumeric(series);

  const brushChangeFunctions = makeBrushChangeFunctions(props);

  let charts = getCharts(
    props,
    yAxisProps,
    parent,
    datas,
    groups,
    dimension,
    brushChangeFunctions
  );

  // charts.map(chart => {
  //   chart.on("filtered.redrawGroup", () => {
  //     //props.redrawCrossfilterGroup();
  //   });
  // });

  parent.on("postRedraw.reset-button", chart => {
    const children = parent.children();
    const hasFilter = false;
    for (let i = 0; i < children.length; ++i) {
      const child = children[i];
      if (child.hasFilter()) {
        parent
          .svg()
          .selectAll("g.reset")
          .remove();
        const x = parent.width() - parent.margins().right * 1.5;
        const y = parent.margins().top * 0.5;
        const textSvg = parent
          .svg()
          .append("g")
          .attr("class", "reset")
          .attr("transform", "translate(" + x + "," + y + ")")
          .attr("x", parent.width() - parent.margins().right)
          .attr("y", parent.margins().top)
          .style("cursor", "pointer")
          .on("click", () => {
            children.map(child => {
              child.replaceFilter(null);
            });
            parent.brush().extent([0, 0]);
            //parent.redrawGroup();
            props.redrawCrossfilterGroup();
          });
        textSvg
          .append("text")
          .attr("text-anchor", "middle")
          .text("RESET");
        break;
      }
    }
  });

  const onGoalHover = addGoalChartAndGetOnGoalHover(
    props,
    xAxisProps.xDomain,
    parent,
    charts
  );
 addTrendlineChart(props, xAxisProps, yAxisProps, parent, charts);

  parent.compose(charts);

  if (groups.length > 1 && !props.isScalarSeries) {
    doGroupedBarStuff(parent);
  } else if (isHistogramBar(props)) {
    doHistogramBarStuff(parent);
  }

  // HACK: compositeChart + ordinal X axis shenanigans. See https://github.com/dc-js/dc.js/issues/678 and https://github.com/dc-js/dc.js/issues/662
  const hasBar = _.any(
    series,
    single => getSeriesDisplay(settings, single) === "bar"
  );
  parent._rangeBandPadding(hasBar ? BAR_PADDING_RATIO : 1);

  applyXAxisSettings(parent, props.series, xAxisProps);

  applyYAxisSettings(parent, yAxisProps);

  setupTooltips(props, datas, parent, brushChangeFunctions);

  parent.render();

  // apply any on-rendering functions (this code lives in `LineAreaBarPostRenderer`)
  crossfilterLineandBarOnRender(
    parent,
    onGoalHover,
    yAxisProps.isSplit,
    isStacked(parent.settings, datas)
  );

  // only ordinal axis can display "null" values
  if (isOrdinal(parent.settings)) {
    delete warnings[NULL_DIMENSION_WARNING];
  }

  if (onRender) {
    onRender({
      yAxisSplit: yAxisProps.yAxisSplit,
      warnings: Object.keys(warnings)
    });
  }

  const deregister = () => dc.chartRegistry.deregister(parent);
  const redraw = () => parent.redraw();
  // return an unregister function
  return {
    deregister,
    redraw
  };
}

export const CrossfilterLineRenderer = (element, props) =>
  lineAreaBar(element, { ...props, chartType: "line" });
export const CrossfilterAreaRenderer = (element, props) =>
  lineAreaBar(element, { ...props, chartType: "area" });
export const CrossfilterBarRenderer = (element, props) =>
  lineAreaBar(element, { ...props, chartType: "bar" });
export const comboRenderer = (element, props) =>
  lineAreaBar(element, { ...props, chartType: "combo" });
export const CrossfilterScatterRenderer = (element, props) =>
  lineAreaBar(element, { ...props, chartType: "scatter" });