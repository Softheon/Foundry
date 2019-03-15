(ns metabase.models.humanization
  "Logic related to humanization of table names and other identifiers, e.g. taking an identifier like `my_table` and
  returning a human-friendly one like `My Table`.

  There are currently three implementations of humanization logic; `:advanced`, cost-based logic is the default; which
  implementation is used is determined by the Setting `humanization-strategy`; `:simple`, which merely replaces
  underscores and dashes with spaces, and `:none`, which predictibly is merely an identity function that does nothing
  to the results.

  The actual algorithm for advanced humanization is in `metabase.util.infer-spaces`. (NOTE: some of the logic is here,
  such as the `captialize-word` function; maybe we should move that so all the logic is in one place?)"
  (:require [clojure.string :as str]
            [clojure.tools.logging :as log]
            [metabase.models.setting :as setting :refer [defsetting]]
            [metabase.util
             [i18n :refer [tru]]
             [infer-spaces :refer [infer-spaces]]]
            [metabase.toucan.db :as db]))

(def ^:private ^:const acronyms
  #{"id" "url" "ip" "uid" "uuid" "guid"})

(defn- capitalize-word [word]
  (if (contains? acronyms (str/lower-case word))
    (str/upper-case word)
    (str/capitalize word)))


(declare humanization-strategy)

(defmulti ^String name->human-readable-name
  "Convert a name, such as `num_toucans`, to a human-readable name, such as `Num Toucans`. With one arg, this uses the
  strategy defined by the Setting `humanization-strategy`. With two args, you may specify a custom strategy (intended
  mainly for the internal implementation):

     (humanization-strategy :advanced)
     (name->human-readable-name \"cooltoucans\")                         ;-> \"Cool Toucans\"
     ;; this is the same as:
     (name->human-readable-name (humanization-strategy) \"cooltoucans\") ;-> \"Cool Toucans\"
     ;; specifiy a different strategy:
     (name->human-readable-name :none \"cooltoucans\")                   ;-> \"cooltoucans\""
  {:arglists '([s] [strategy s])}
  (fn
    ([_] (keyword (humanization-strategy)))
    ([strategy _] (keyword strategy))))

;; :advanced is the default implementation; splits words with cost-based fn
(defmethod name->human-readable-name :advanced
  ([s] (name->human-readable-name :advanced s))
  ([_, ^String s]
   ;; explode string on hyphens, underscores, spaces, and camelCase
   (when (seq s)
     (str/join " " (for [part  (str/split s #"[-_\s]+|(?<=[a-z])(?=[A-Z])")
                         :when (not (str/blank? part))
                         word  (dedupe (flatten (infer-spaces part)))]
                     (capitalize-word word))))))

;; simple replaces hyphens and underscores with spaces
(defmethod name->human-readable-name :simple
  ([s] (name->human-readable-name :simple s))
  ([_, ^String s]
   ;; explode on hypens, underscores, and spaces
   (when (seq s)
     (str/join " " (for [part  (str/split s #"[-_\s]+")
                         :when (not (str/blank? part))]
                     (capitalize-word part))))))

;; :none is just an identity implementation
(defmethod name->human-readable-name :none
  ([s]   s)
  ([_ s] s))


(defn- custom-display-name?
  "Is `display-name` a custom name that was set manually by the user in the metadata edit screen?"
  [internal-name display-name]
  ;; Try all the different implementations of name->human-readable-name. If any (f internal-name) is equal to
  ;; display-name we can safely assume that display-name was set automatically using that strategy and stop there.
  ;; Otherwise if none of the strategies match (i.e. `some` returns `nil`) we can assume a custom name was set.
  (nil? (some #(= display-name (% internal-name))
              (vals (methods name->human-readable-name)))))

(defn- re-humanize-names!
  "Update all non-custom display names of all instances of `model` (e.g. Table or Field)."
  [model]
  (run! (fn [{id :id, internal-name :name, display-name :display_name}]
          (let [new-display-name (name->human-readable-name internal-name)]
            (when (and (not= display-name new-display-name)
                       (not (custom-display-name? internal-name display-name)))
              (log/info (format "Updating display name for %s '%s': '%s' -> '%s'"
                                (name model) internal-name display-name new-display-name))
              (db/update! model id
                :display_name new-display-name))))
        (db/select-reducible [model :id :name :display_name])))

(defn- re-humanize-table-and-field-names!
  "Update the non-custom display names of all Tables & Fields in the database using new values obtained from
  the (obstensibly swapped implementation of) `name->human-readable-name`."
  []
  (re-humanize-names! 'Table)
  (re-humanize-names! 'Field))


(defn- set-humanization-strategy! [new-strategy]
  ;; check to make sure `new-strategy` is a valid strategy, or throw an Exception it is it not.
  (when-not (get-method name->human-readable-name (keyword new-strategy))
    (throw (IllegalArgumentException. (format "Invalid humanization strategy %s. Valid strategies are: %s"
                                              new-strategy (keys (methods name->human-readable-name))))))
  ;; ok, now set the new value
  (setting/set-string! :humanization-strategy (name new-strategy))
  ;; now rehumanize all the Tables and Fields using the new strategy.
  ;; TODO: Should we do this in a background thread because it is potentially slow?
  (log/info (format "Now using %s table name humanization." new-strategy))
  (re-humanize-table-and-field-names!))

(defsetting ^{:added "0.28.0"} humanization-strategy
  (str (tru "Foundry can attempt to transform your table and field names into more sensible, human-readable versions, e.g. \"somehorriblename\" becomes \"Some Horrible Name\".")
       " "
       (tru "This doesn’t work all that well if the names are in a language other than English, however.")
       " "
       (tru "Do you want us to take a guess?"))
  :default "advanced"
  :setter  set-humanization-strategy!)
