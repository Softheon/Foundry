/* @flow */

import React, { Component } from "react";
import ReactDOM from "react-dom";
import { t } from "c-3po";
import cx from "classnames";
import d3 from "d3";
import _ from "underscore";
import crossfilter from "crossfilter";

import styles from "./PieChart.css";
import ChartTooltip from "../components/ChartTooltip.jsx";
import ChartWithLegend from "../components/ChartWithLegend.jsx";

import { ChartSettingsError } from "metabase/visualizations/lib/errors";
import { getFriendlyName } from "metabase/visualizations/lib/utils";
import {
  metricSetting,
  dimensionSetting,
} from "metabase/visualizations/lib/settings/utils";
import { columnSettings } from "metabase/visualizations/lib/settings/column";

import { formatValue } from "metabase/lib/formatting";

import colors, { getColorsForValues } from "metabase/lib/colors";
import type { VisualizationProps } from "metabase/meta/types/Visualization";

import connectWithCrossfilter from "../lib/connectWithCrossfilter.js";
import CrossfilterPie from "../components/CrossfilterPie.jsx";

const OUTER_RADIUS = 50; // within 100px canvas
const INNER_RADIUS_RATIO = 3 / 5;

const PAD_ANGLE = Math.PI / 180 * 1; // 1 degree in radians
const SLICE_THRESHOLD = 0.025; // approx 1 degree in percentage
const OTHER_SLICE_MIN_PERCENTAGE = 0.003;

const PERCENT_REGEX = /percent/i;

@connectWithCrossfilter
export default class CrossfilterPieChart extends Component {
  props: VisualizationProps;

  static uiName = t`Pie`;
  static identifier = "pie";
  static iconName = "pie";
  static minSize = { width: 4, height: 4 };

  static isSensible({ cols, rows }) {
    return cols.length === 2;
  }

  static checkRenderable([{ data: { cols, rows } }], settings) {
    if (!settings["pie.dimension"] || !settings["pie.metric"]) {
      throw new ChartSettingsError(t`Which columns do you want to use?`, {
        section: `Data`,
      });
    }
  }

  static settings = {
    ...columnSettings({ hidden: true }),
    ...dimensionSetting("pie.dimension", {
      section: t`Data`,
      title: t`Dimension`,
      showColumnSetting: true,
    }),
    ...metricSetting("pie.metric", {
      section: t`Data`,
      title: t`Measure`,
      showColumnSetting: true,
    }),
    "pie.show_legend": {
      section: t`Display`,
      title: t`Show legend`,
      widget: "toggle",
    },
    "pie.show_legend_perecent": {
      section: t`Display`,
      title: t`Show percentages in legend`,
      widget: "toggle",
      default: true,
    },
    "pie.slice_threshold": {
      section: t`Display`,
      title: t`Minimum slice percentage`,
      widget: "number",
      default: SLICE_THRESHOLD * 100,
    },
    "pie.colors": {
      section: t`Display`,
      title: t`Colors`,
      widget: "colors",
      getDefault: (series, settings) =>
        settings["pie._dimensionValues"]
          ? getColorsForValues(settings["pie._dimensionValues"])
          : [],
      getProps: (series, settings) => ({
        seriesTitles: settings["pie._dimensionValues"] || [],
      }),
      getDisabled: (series, settings) => !settings["pie._dimensionValues"],
      readDependencies: ["pie._dimensionValues"],
    },
    // this setting recomputes color assignment using pie.colors as the existing
    // assignments in case the user previous modified pie.colors and a new value
    // has appeared. Not ideal because those color values will be missing in the
    // settings UI
    "pie._colors": {
      getValue: (series, settings) =>
        getColorsForValues(
          settings["pie._dimensionValues"],
          settings["pie.colors"],
        ),
      readDependencies: ["pie._dimensionValues", "pie.colors"],
    },
    "pie._metricIndex": {
      getValue: ([{ data: { cols } }], settings) =>
        _.findIndex(cols, col => col.name === settings["pie.metric"]),
      readDependencies: ["pie.metric"],
    },
    "pie._dimensionIndex": {
      getValue: ([{ data: { cols } }], settings) =>
        _.findIndex(cols, col => col.name === settings["pie.dimension"]),
      readDependencies: ["pie.dimension"],
    },
    "pie._dimensionValues": {
      getValue: ([{ data: { rows } }], settings) => {
        const dimensionIndex = settings["pie._dimensionIndex"];
        return dimensionIndex >= 0
          ? // cast to string because getColorsForValues expects strings
            rows.map(row => String(row[dimensionIndex]))
          : null;
      },
      readDependencies: ["pie._dimensionIndex"],
    },
  };

  constructor(props) {
    super(props);
    const { isCrossfilterSource } = this.props;

    const { rawSeries } = this.props;
    let dataset = null;
    if (isCrossfilterSource) {
      const { rawSeries } = this.props;
      const [{ data: { cols, rows } }] = rawSeries;
      dataset = crossfilter(rows);
    } else {
      dataset = this.props.getSourceCrossfilter();
    }
    const { dimension, dimensionIndex } = this.initializeDimension(dataset);
    const { group, metricIndex } = this.initializeGroup(dimension);
    if (isCrossfilterSource) {
      this.props.addSourceCrossfilter({
        crossfilter: dataset,
        dimension,
        group,
        dimensionIndex,
        metricIndex,
      });
    } else {
      this.props.setDimension(dimension);
      this.props.setGroup(group);
    }

    // this.props.setKeyAccessor(d => d.dimensions[0].value);
  }

  componentDidUpdate() {
    // let groupElement = ReactDOM.findDOMNode(this.refs.group);
    // let detailElement = ReactDOM.findDOMNode(this.refs.detail);
    // if (groupElement.getBoundingClientRect().width < 100) {
    //   detailElement.classList.add("hide");
    // } else {
    //   detailElement.classList.remove("hide");
    // }
  }

  componentDidMount() {
    // console.log("xia:  PieChartSVG ref", this.refs.PieChartSVG);

    const { isCrossfilterSource } = this.props;

    if (isCrossfilterSource) {
      this.props.redrawCrossfilterGroup();
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (nextProps.activeGroup === this.props.crossfilterGroup) {
      return true;
    }
  }
  initializeDimension(crossfilter) {
    const { settings } = this.props;
    const dimensionIndex = settings["pie._dimensionIndex"];
    const dimension = crossfilter.dimension(d => d[dimensionIndex]);
    return { dimension, dimensionIndex };
  }

  initializeGroup(dimension) {
    const { settings } = this.props;
    const metricIndex = settings["pie._metricIndex"];
    let group = dimension.group().reduceSum(d => d[metricIndex]);

    return { group, metricIndex };
  }

  getFilteredRows = () => {
    const filteredRecords = this.props.crossfilterData();
    let rows = filteredRecords.map(d => [d.key, d.value]);
    return rows;
  };

  isSelectedSlice(d) {
    return this.props.hasFilter(d);
  }

  getSliceOpacity(key, index) {
    if (this.props.hasFilter()) {
      return this.isSelectedSlice(key) ? 1 : 0.3;
    } else {
      return 1;
    }
  }

  render() {
    const {
      series,
      hovered,
      onHoverChange,
      visualizationIsClickable,
      onVisualizationClick,
      className,
      gridSize,
      settings,
    } = this.props;

    let [{ data: { cols, rows } }] = series;
    const dimensionIndex = settings["pie._dimensionIndex"];
    const metricIndex = settings["pie._metricIndex"];
    let dataRowDimensionIndex = 0;
    let dataRowMetricIndex = 1;
    rows = this.getFilteredRows();

    const formatDimension = (dimension, jsx = true) =>
      formatValue(dimension, {
        ...settings.column(cols[dimensionIndex]),
        jsx,
        majorWidth: 0,
      });
    const formatMetric = (metric, jsx = true) =>
      formatValue(metric, {
        ...settings.column(cols[metricIndex]),
        jsx,
        majorWidth: 0,
      });
    const formatPercent = (percent, jsx = true) =>
      formatValue(percent, {
        ...settings.column(cols[metricIndex]),
        jsx,
        majorWidth: 3,
        number_style: "percent",
        minimumSignificantDigits: 3,
        maximumSignificantDigits: 3,
        maximumFractionDigits: 3,
      });

    const showPercentInTooltip =
      !PERCENT_REGEX.test(cols[metricIndex].name) &&
      !PERCENT_REGEX.test(cols[metricIndex].display_name);

    const ndx = this.props.getSourceCrossfilter();
    const all = ndx.groupAll();
    const groupAll = all.reduceSum(d => d[metricIndex]);
    let total = groupAll.value();
    all.dispose();
    groupAll.dispose();

    let sliceThreshold =
      typeof settings["pie.slice_threshold"] === "number"
        ? settings["pie.slice_threshold"] / 100
        : SLICE_THRESHOLD;

    let [slices, others] = _.chain(rows)
      .map((row, index) => ({
        key: row[dataRowDimensionIndex],
        value: row[dataRowMetricIndex],
        percentage:
          (this.props.hasFilter() &&
          !this.props.hasFilter(row[dataRowDimensionIndex])
            ? 0
            : row[dataRowMetricIndex]) *
          1.0 /
          total,
        color: settings["pie._colors"][row[dataRowDimensionIndex]],
      }))
      .partition(d => d.percentage > sliceThreshold)
      .value();

    let otherSlice = null;
    if (others && others.length > 1) {
      let otherTotal = others.reduce((acc, o) => acc + o.value, 0);
      if (otherTotal > 0) {
        otherSlice = {
          key: "Other",
          value: otherTotal,
          percentage: otherTotal / total,
          color: colors["text-light"],
        };
        slices.push(otherSlice);
      }
    } else {
      slices.push(...others);
    }

    // increase "other" slice so it's barely visible
    // $FlowFixMe
    if (otherSlice && otherSlice.percentage < OTHER_SLICE_MIN_PERCENTAGE) {
      otherSlice.value = total * OTHER_SLICE_MIN_PERCENTAGE;
    }

    slices = slices.map(slice => {
      return {
        ...slice,
        percentage:
          (this.props.hasFilter() && !this.props.hasFilter(slice.key)
            ? 0
            : slice.value) / total,
      };
    });
    let legendTitles = slices.map(slice => [
      slice.key === "Other" ? slice.key : formatDimension(slice.key, true),
      settings["pie.show_legend_perecent"]
        ? formatPercent(slice.percentage, true)
        : undefined,
    ]);
    let legendColors = slices.map(slice => slice.color);

    // no non-zero slices
    if (slices.length === 0) {
      otherSlice = {
        value: 1,
        color: colors["text-light"],
        noHover: true,
      };
      slices.push(otherSlice);
    }

    function hoverForIndex(index, event) {
      console.log("hoverForIndex event", event);
      const slice = slices[index];
      if (!slice || slice.noHover) {
        return null;
      } else if (slice === otherSlice) {
        return {
          index,
          event: event,
          data: others.map(o => ({
            key: formatDimension(o.key, false),
            value: formatMetric(o.value, false),
          })),
        };
      } else {
        return {
          index,
          event: event,
          data: [
            {
              key: getFriendlyName(cols[dimensionIndex]),
              value: formatDimension(slice.key),
            },
            {
              key: getFriendlyName(cols[metricIndex]),
              value: formatMetric(slice.value),
            },
          ].concat(
            showPercentInTooltip && slice.percentage != null
              ? [
                  {
                    key: "Percentage",
                    value: formatPercent(slice.percentage),
                  },
                ]
              : [],
          ),
        };
      }
    }

    let value, title;
    if (
      hovered &&
      hovered.index != null &&
      slices[hovered.index] !== otherSlice
    ) {
      title = formatDimension(slices[hovered.index].key);
      value = formatMetric(slices[hovered.index].value);
    } else {
      title = t`Total`;
      value = formatMetric(total);
    }

    const getSliceClickObject = index => ({
      value: slices[index].value,
      column: cols[metricIndex],
      dimensions: [
        {
          value: slices[index].key,
          column: cols[dimensionIndex],
        },
      ],
    });

    const isClickable =
      onVisualizationClick && visualizationIsClickable(getSliceClickObject(0));
    const getSliceIsClickable = index =>
      isClickable && slices[index] !== otherSlice;

    return (
      <ChartWithLegend
        className={className}
        legendTitles={legendTitles}
        legendColors={legendColors}
        gridSize={gridSize}
        hovered={hovered}
        onHoverChange={d =>
          onHoverChange &&
          onHoverChange(d && { ...d, ...hoverForIndex(d.index) })
        }
        showLegend={settings["pie.show_legend"]}
      >
        <div className={styles.ChartAndDetail}>
          <div ref="detail" className={styles.Detail}>
            <div
              className={cx(
                styles.Value,
                "fullscreen-normal-text fullscreen-night-text",
              )}
            >
              {value}
            </div>
            <div className={styles.Title}>{title}</div>
          </div>
          <div className={styles.Chart}>
            <CrossfilterPie
              data={slices}
              onClick={this.props.onClick}
              hasFilter={this.props.hasFilter}
              isSelectedSlice={this.isSelectedSlice}
              highlightSelected={this.props.highlightSelected}
              fadeDeselected={this.props.fadeDeselected}
              resetHighlight={this.props.resetHighlight}
              onMouseMove={(index, e) =>
                null && onHoverChange && onHoverChange(hoverForIndex(index, e))
              }
              onMouseLeave={() => null && onHoverChange && onHoverChange(null)}
            />
            {this.props.hasFilter() && (
              <a
                style={{ position: "absolute", right: 0 }}
                onClick={this.props.filterAll}
              >
                {" "}
                {t`RESET`}{" "}
              </a>
            )}
          </div>
        </div>
        <ChartTooltip series={series} hovered={hovered} />
      </ChartWithLegend>
    );
  }
}
